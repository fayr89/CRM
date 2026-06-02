// TEMP — ежедневный диаг-эндпоинт (сессия zVkCV). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-daily-zVkCV-9qR2';

router.get('/daily-data', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const [approved, revision, rejected, openFeedback] = await Promise.all([
      db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 20`),
      db.all(`
        SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open', 'awaiting_approval')
        ORDER BY f.created_at DESC
      `),
    ]);

    const feedbackIds = openFeedback.map(f => f.id);
    let threads = [];
    if (feedbackIds.length > 0) {
      threads = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.map(() => '?').join(',')}]::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        ...feedbackIds,
      );
    }

    const threadsByFeedback = {};
    for (const msg of threads) {
      if (!threadsByFeedback[msg.feedback_id]) threadsByFeedback[msg.feedback_id] = [];
      threadsByFeedback[msg.feedback_id].push(msg);
    }

    res.json({
      proposals: { approved, revision, rejected },
      feedback: openFeedback.map(f => ({
        ...f,
        messages: threadsByFeedback[f.id] || [],
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
