import { Router } from 'express';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const onlyUnread = req.query.unread === 'true';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (onlyUnread) where.push('read_at IS NULL');
    const rows = await db.all(
      `SELECT * FROM notifications WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`,
      ...params,
      limit,
    );
    const { unread } = await db.get(
      `SELECT COUNT(*)::int AS unread FROM notifications
       WHERE user_id = ? AND read_at IS NULL`,
      req.user.id,
    );
    res.json({ data: rows, unread });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await db.run(
      `UPDATE notifications SET read_at = NOW()
       WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      req.params.id,
      req.user.id,
    );
    res.json({ ok: true });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await db.run(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = ? AND read_at IS NULL`,
      req.user.id,
    );
    res.json({ ok: true });
  }),
);

export default router;
