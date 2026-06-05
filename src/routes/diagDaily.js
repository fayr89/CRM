// TEMP — удалить после использования (cleanup коммит идёт следом)
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-2026-06-05-v38-x7k2';

router.get('/feedback-full', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const feedbacks = await db.all(`
      SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
             f.created_at, f.updated_at,
             u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.updated_at DESC
      LIMIT 100
    `);
    const threads = await db.all(`
      SELECT fm.feedback_id, fm.id, fm.role, fm.user_name, fm.message, fm.created_at
      FROM feedback_messages fm
      WHERE fm.feedback_id = ANY(SELECT id FROM feedback ORDER BY updated_at DESC LIMIT 100)
      ORDER BY fm.feedback_id, fm.created_at
    `);
    const proposals = await db.all(`
      SELECT * FROM ai_proposals
      WHERE status IN ('approved','revision','rejected','pending')
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const threadMap = {};
    for (const t of threads) {
      if (!threadMap[t.feedback_id]) threadMap[t.feedback_id] = [];
      threadMap[t.feedback_id].push(t);
    }
    res.json({
      feedbacks: feedbacks.map(f => ({ ...f, thread: threadMap[f.id] || [] })),
      proposals,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
