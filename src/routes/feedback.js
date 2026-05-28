import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();

const createSchema = z.object({
  category: z.enum(['bug', 'question', 'suggestion', 'other']).optional().default('other'),
  subject: z.string().min(1, 'Заполните тему').max(200),
  message: z.string().min(1, 'Заполните сообщение').max(5000),
  context: z.string().optional().nullable(),
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
    const r = await db.run(
      `INSERT INTO feedback (user_id, category, subject, message, context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW()) RETURNING id`,
      req.user.id,
      data.category,
      data.subject,
      data.message,
      data.context ?? null,
    );
    const row = await db.get(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
      r.lastInsertRowid,
    );
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
