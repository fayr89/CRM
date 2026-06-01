// Баннеры уведомлений сверху страницы. Админ создаёт/удаляет, пользователь
// видит активные (now BETWEEN starts_at AND ends_at).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

// Активные баннеры для отображения — доступно всем авторизованным.
router.get(
  '/active',
  asyncHandler(async (_req, res) => {
    const rows = await db.all(
      `SELECT id, text, kind, starts_at, ends_at, dismissible
       FROM notice_banners
       WHERE NOW() BETWEEN starts_at AND ends_at
       ORDER BY created_at DESC`,
    );
    res.json({ data: rows });
  }),
);

// Полный список для админа (включая истёкшие).
router.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const rows = await db.all(
      `SELECT b.*, u.name AS created_by_name,
              CASE WHEN NOW() BETWEEN b.starts_at AND b.ends_at THEN TRUE ELSE FALSE END AS is_active
       FROM notice_banners b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC`,
    );
    res.json({ data: rows });
  }),
);

const createSchema = z.object({
  text: z.string().min(1).max(2000),
  kind: z.enum(['info', 'warning', 'success', 'error']).optional().default('info'),
  // Длительность в днях с момента создания. Альтернативно можно передать ends_at напрямую.
  duration_days: z.number().int().positive().max(365).optional(),
  ends_at: z.string().optional(),
  dismissible: z.boolean().optional().default(true),
});

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body || {});
    let endsAtSql;
    let endsAtParam = null;
    if (data.ends_at) {
      endsAtSql = '?';
      endsAtParam = data.ends_at;
    } else {
      const days = data.duration_days || 3;
      endsAtSql = `NOW() + (? || ' days')::interval`;
      endsAtParam = String(days);
    }
    const r = await db.run(
      `INSERT INTO notice_banners (text, kind, ends_at, dismissible, created_by)
       VALUES (?, ?, ${endsAtSql}, ?, ?) RETURNING id`,
      data.text, data.kind || 'info', endsAtParam, data.dismissible !== false, req.user.id,
    );
    res.status(201).json(await db.get('SELECT * FROM notice_banners WHERE id = ?', r.lastInsertRowid));
  }),
);

const updateSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  kind: z.enum(['info', 'warning', 'success', 'error']).optional(),
  ends_at: z.string().optional(),
  dismissible: z.boolean().optional(),
});

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body || {});
    const cur = await db.get('SELECT * FROM notice_banners WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Баннер не найден');
    const updates = [];
    const params = [];
    for (const key of ['text', 'kind', 'ends_at', 'dismissible']) {
      if (data[key] !== undefined) { updates.push(`${key} = ?`); params.push(data[key]); }
    }
    if (!updates.length) return res.json(cur);
    params.push(cur.id);
    await db.run(`UPDATE notice_banners SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM notice_banners WHERE id = ?', cur.id));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await db.run('DELETE FROM notice_banners WHERE id = ?', req.params.id);
    if (r.changes === 0) throw NotFound('Баннер не найден');
    res.status(204).send();
  }),
);

export default router;
