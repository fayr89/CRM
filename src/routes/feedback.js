import express from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';
import { notifyAdmins } from '../services/notifications.js';

const router = Router();

// На этом роуте принимаем base64-вложения: глобальный лимит 1mb недостаточен.
// Подменяем JSON-парсер локально на 10mb (5 файлов × 2mb после base64 ≈ 13.5mb,
// округляем до 10mb — это hard cap на запрос с фронта).
router.use(express.json({ limit: '10mb' }));

// Лимит на размер одного вложения и общее число. 2 МБ — типичный скриншот
// помещается с запасом; ограничение тут согласовано с body-limit на роуте (10mb).
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  type: z.string().max(100).optional().nullable(),
  size: z.number().int().nonnegative().max(MAX_ATTACHMENT_SIZE).optional().nullable(),
  // data URL вида "data:image/png;base64,..." или произвольный mime — на бэке
  // не парсим, только проверяем длину (base64 ≈ 4/3 от сырого размера).
  content: z.string().min(1).max(Math.ceil(MAX_ATTACHMENT_SIZE * 1.4) + 100),
});

const createSchema = z.object({
  category: z.enum(['bug', 'question', 'suggestion', 'other']).optional().default('other'),
  subject: z.string().min(1, 'Заполните тему').max(200),
  message: z.string().min(1, 'Заполните сообщение').max(5000),
  context: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional().nullable(),
});

const updateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'closed']).optional(),
  admin_reply: z.string().max(5000).optional().nullable(),
});

router.use(authenticate);

// Создать обращение — любая залогиненная роль.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body || {});
    const attachmentsJson = data.attachments && data.attachments.length
      ? JSON.stringify(data.attachments)
      : null;
    const r = await db.run(
      `INSERT INTO feedback (user_id, category, subject, message, context, attachments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW()) RETURNING id`,
      req.user.id,
      data.category,
      data.subject,
      data.message,
      data.context ?? null,
      attachmentsJson,
    );
    const row = await db.get(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
      r.lastInsertRowid,
    );
    // Уведомляем всех админов о новом обращении (для бейджа на колокольчике).
    try {
      const catLabel = { bug: 'Баг', question: 'Вопрос', suggestion: 'Предложение', other: 'Сообщение' }[data.category] || 'Сообщение';
      await notifyAdmins(
        'feedback.new',
        `📮 ${catLabel}: ${data.subject}`,
        `${row.user_name || 'Пользователь'} (${row.user_role || '—'}): ${data.message.slice(0, 200)}`,
        '#/feedback',
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[feedback] notify:', e.message);
    }
    res.status(201).json(row);
  }),
);

// Список обращений — только админ. Фильтр по status.
router.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('f.status = ?');
      params.push(req.query.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
              r.name AS resolved_by_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.resolved_by
       ${whereSql}
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM feedback f ${whereSql}`,
      ...params,
    );
    const { open_count } = await db.get(
      `SELECT COUNT(*)::int AS open_count FROM feedback WHERE status = 'open'`,
    );
    res.json({ ...paginated(rows, total, page, limit), open_count });
  }),
);

// Количество открытых обращений — для бейджа в админ-навигации.
router.get(
  '/open-count',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const { c } = await db.get(`SELECT COUNT(*)::int AS c FROM feedback WHERE status = 'open'`);
    res.json({ count: c || 0 });
  }),
);

// Сменить статус / ответить — только админ.
router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body || {});
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Обращение не найдено');
    if (data.status === undefined && data.admin_reply === undefined) {
      throw BadRequest('Нечего обновлять');
    }
    const newStatus = data.status ?? cur.status;
    const resolvedAtSql = newStatus === 'closed' && cur.status !== 'closed' ? 'NOW()' : null;
    const resolvedBy = newStatus === 'closed' && cur.status !== 'closed' ? req.user.id : cur.resolved_by;
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?,
         resolved_at = ${resolvedAtSql ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      data.admin_reply ?? null,
      resolvedBy,
      req.params.id,
    );
    const row = await db.get(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
              r.name AS resolved_by_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.resolved_by
       WHERE f.id = ?`,
      req.params.id,
    );
    res.json(row);
  }),
);

export default router;
