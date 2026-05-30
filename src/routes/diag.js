// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
// Защита — одноразовый секрет в query. Возвращает обращения для разбора.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '4c4e7940387e5f671ae8eba1fa1c384e68d1dc81023a7113';

router.get(
  '/feedback-dump',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) {
      return res.status(404).json({ error: 'not found' });
    }
    const rows = await db.all(
      `SELECT f.id, f.category, f.subject, f.message, f.status, f.context, f.admin_reply,
              f.created_at, f.resolved_at,
              u.name AS user_name, u.role AS user_role,
              CASE WHEN f.attachments IS NULL THEN 0
                   WHEN jsonb_typeof(f.attachments) = 'array' THEN jsonb_array_length(f.attachments)
                   ELSE 0 END AS attachments_count
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`,
    );
    res.json({ data: rows, total: rows.length });
  }),
);

export default router;
