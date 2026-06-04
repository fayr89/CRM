// TEMP: ежедневный AI-обход 2026-06-04-v3. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'd2026-06-04-v3-xZ8q';
const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });

  const op = req.query.op || 'list-feedback';

  if (op === 'list-proposals') {
    const status = req.query.status || 'pending';
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status = ?
       ORDER BY p.created_at DESC`,
      status,
    );
    return res.json({ data: rows });
  }

  if (op === 'list-feedback') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at ASC`,
    );
    const ids = rows.map(r => r.id);
    let messages = [];
    if (ids.length > 0) {
      messages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${ids.map(() => '?').join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
        ...ids,
      );
    }
    const byFeedback = {};
    for (const m of messages) byFeedback[m.feedback_id] = [...(byFeedback[m.feedback_id] || []), m];
    const result = rows.map(r => ({ ...r, messages: byFeedback[r.id] || [] }));
    return res.json({ data: result });
  }

  res.status(400).json({ error: 'unknown op' });
}));

export default router;
