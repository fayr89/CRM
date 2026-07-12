import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v302-3f9a1c';

router.get('/daily-v302', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`,
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`,
      );
      const feedbackOpenCount = await db.get(
        `SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`,
      );
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      return res.json({
        proposalsByStatus,
        proposalsLastUpdate: proposalsLastUpdate?.t,
        feedbackLastMsg: feedbackLastMsg?.t,
        feedbackOpenCount: feedbackOpenCount?.n,
        proposalsTotal: proposalsTotal?.n,
      });
    }
    if (op === 'get-feedback-summary') {
      const rows = await db.all(`
        SELECT f.id, f.status, f.updated_at,
          (SELECT m.user_name FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_msg_user,
          (SELECT m.created_at FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_msg_at
        FROM feedback f
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.id
      `);
      return res.json(rows);
    }
    if (op === 'proposals') {
      const status = req.query.status;
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals WHERE status = ? ORDER BY id`,
        status,
      );
      return res.json(rows);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
