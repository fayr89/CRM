import express from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';
import { notify, notifyAdmins } from '../services/notifications.js';

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
  status: z.enum(['open', 'in_progress', 'awaiting_approval', 'closed']).optional(),
  admin_reply: z.string().max(5000).optional().nullable(),
});

const rejectSchema = z.object({
  reason: z.string().min(1, 'Укажите причину отказа').max(2000),
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
        `#/feedback?id=${row.id}`,
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

// Получить одно обращение по id — нужен для глубоких ссылок из уведомлений.
// Доступно админу (любое) и автору (своё). Включает messages и attachments.
router.get(
  '/by-id/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw BadRequest('id required');
    const row = await db.get(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
              r.name AS resolved_by_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.resolved_by
       WHERE f.id = ?`,
      id,
    );
    if (!row) throw NotFound('Обращение не найдено');
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      throw Forbidden('Доступ только админу или автору обращения');
    }
    res.json(row);
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

// Список своих обращений + счётчик «требуется ваше подтверждение».
// Доступно любой залогиненной роли.
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.role AS user_role,
              r.name AS resolved_by_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.resolved_by
       WHERE f.user_id = ?
       ORDER BY (CASE f.status WHEN 'awaiting_approval' THEN 0 WHEN 'in_progress' THEN 1
                 WHEN 'open' THEN 2 ELSE 3 END), f.created_at DESC`,
      req.user.id,
    );
    const { awaiting } = await db.get(
      `SELECT COUNT(*)::int AS awaiting FROM feedback
       WHERE user_id = ? AND status = 'awaiting_approval'`,
      req.user.id,
    );
    res.json({ data: rows, awaiting_count: awaiting || 0 });
  }),
);

// Подтвердить, что задача принята (только автор обращения). awaiting → closed.
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Обращение не найдено');
    if (cur.user_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('Подтвердить может только автор обращения');
    }
    if (cur.status !== 'awaiting_approval') {
      throw BadRequest('Обращение не в статусе «На подтверждении»');
    }
    await db.run(
      `UPDATE feedback SET status = 'closed', resolved_at = NOW(),
       updated_at = NOW() WHERE id = ?`,
      cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
  }),
);

// Отказаться от приёмки (только автор). awaiting → open, с причиной.
// Админ получает уведомление, что задача возвращена в работу.
router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const { reason } = rejectSchema.parse(req.body || {});
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Обращение не найдено');
    if (cur.user_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('Отклонить может только автор обращения');
    }
    if (cur.status !== 'awaiting_approval') {
      throw BadRequest('Обращение не в статусе «На подтверждении»');
    }
    await db.run(
      `UPDATE feedback SET status = 'open', rejected_reason = ?,
       resolved_at = NULL, updated_at = NOW() WHERE id = ?`,
      reason,
      cur.id,
    );
    try {
      await notifyAdmins(
        'feedback.rejected',
        `📮 Обращение #${cur.id} возвращено в работу`,
        `${req.user.name || 'Пользователь'}: ${reason.slice(0, 200)}`,
        `#/feedback?id=${cur.id}`,
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[feedback reject] notify:', e.message);
    }
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
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
    // resolved_by/at: фиксируем кто и когда «исполнил» — это момент перехода в
    // awaiting_approval (а не closed, как было раньше). При закрытии — оставляем
    // как есть, при возврате в open чистится отдельно через /reject.
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    const resolvedAtSql = justResolved ? 'NOW()' : 'resolved_at';
    const resolvedBy = justResolved ? req.user.id : cur.resolved_by;
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?,
         resolved_at = ${resolvedAtSql === 'NOW()' ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      data.admin_reply ?? null,
      resolvedBy,
      req.params.id,
    );
    // Уведомляем автора если перевели на подтверждение.
    if (newStatus === 'awaiting_approval' && cur.status !== 'awaiting_approval' && cur.user_id) {
      try {
        await notify(
          cur.user_id,
          'feedback.awaiting_approval',
          `📮 Подтвердите выполнение: ${cur.subject}`,
          (data.admin_reply || cur.admin_reply || 'Админ отметил задачу как выполненную. Проверьте и подтвердите.').slice(0, 300),
          `#/my-feedback?id=${cur.id}`,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[feedback awaiting] notify:', e.message);
      }
    }
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

// --- Thread обсуждения внутри обращения (уточнения админ ↔ автор) ---

// Доступ: автор обращения или админ. Возвращаем сообщения в хронологическом порядке.
async function canSeeThread(req, feedback) {
  if (!feedback) return false;
  return req.user.role === 'admin' || feedback.user_id === req.user.id;
}

router.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', req.params.id);
    if (!fb) throw NotFound('Обращение не найдено');
    if (!(await canSeeThread(req, fb))) throw Forbidden();
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, attachments, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    res.json({ data: rows });
  }),
);

const messageSchema = z.object({
  text: z.string().min(1, 'Введите текст').max(5000),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).optional().nullable(),
});
router.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = ?', req.params.id);
    if (!fb) throw NotFound('Обращение не найдено');
    if (!(await canSeeThread(req, fb))) throw Forbidden();
    const { text, attachments } = messageSchema.parse(req.body || {});
    const role = req.user.role === 'admin' ? 'admin' : 'author';
    const attachmentsJson = attachments && attachments.length ? JSON.stringify(attachments) : null;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
       VALUES (?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      fb.id,
      req.user.id,
      req.user.name || null,
      role,
      text,
      attachmentsJson,
    );
    // Уведомления: админ задал вопрос → автору; автор ответил → админам.
    try {
      if (role === 'admin' && fb.user_id && fb.user_id !== req.user.id) {
        await notify(
          fb.user_id,
          'feedback.message',
          `💬 Вопрос по обращению: ${fb.subject}`,
          text.slice(0, 300),
          `#/my-feedback?id=${fb.id}`,
        );
      } else if (role === 'author') {
        await notifyAdmins(
          'feedback.message',
          `💬 Ответ по обращению #${fb.id}: ${fb.subject}`,
          `${req.user.name || 'Автор'}: ${text.slice(0, 200)}`,
          `#/feedback?id=${fb.id}`,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[feedback msg] notify:', e.message);
    }
    const created = await db.get(
      `SELECT id, user_id, user_name, role, text, attachments, created_at
       FROM feedback_messages WHERE id = ?`,
      r.lastInsertRowid,
    );
    res.status(201).json(created);
  }),
);

export default router;
