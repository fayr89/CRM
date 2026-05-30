// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
// Возвращает обращения + thread сообщений для каждого.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7379308d9f437c56d08edb04888af12e3eadbb0a538f768a';

router.get(
  '/feedback-full',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const items = await db.all(
      `SELECT f.id, f.category, f.subject, f.message, f.status, f.context,
              f.admin_reply, f.rejected_reason, f.created_at, f.resolved_at,
              u.name AS user_name, u.role AS user_role,
              CASE WHEN f.attachments IS NULL THEN 0
                   WHEN jsonb_typeof(f.attachments) = 'array' THEN jsonb_array_length(f.attachments)
                   ELSE 0 END AS attachments_count
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.id DESC`,
    );
    const ids = items.map((x) => x.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?)
         ORDER BY feedback_id ASC, created_at ASC, id ASC`,
        ids,
      );
    }
    const byFb = new Map();
    for (const m of messages) {
      if (!byFb.has(m.feedback_id)) byFb.set(m.feedback_id, []);
      byFb.get(m.feedback_id).push(m);
    }
    res.json({
      data: items.map((it) => ({ ...it, messages: byFb.get(it.id) || [] })),
      total: items.length,
    });
  }),
);

export default router;
