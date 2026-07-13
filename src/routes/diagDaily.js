import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const SECRET = 'daily-v316-7e2b4d';

router.get('/daily-v316', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  try {
    const op = req.query.op || 'meta';

    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS ts FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS ts FROM feedback_messages`
      );
      return res.json({
        proposals_by_status: proposalsByStatus,
        feedback_by_status: feedbackByStatus,
        proposals_last_update: proposalsLastUpdate.ts,
        feedback_last_msg: feedbackLastMsg.ts
      });
    }

    if (op === 'proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, category, created_at, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY id`,
        [status]
      );
      return res.json(rows);
    }

    if (op === 'get-feedback-summary') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT m.user_name FROM feedback_messages m WHERE m.feedback_id = f.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_msg_user,
                (SELECT m.created_at FROM feedback_messages m WHERE m.feedback_id = f.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_msg_at,
                (SELECT LEFT(m.text, 120) FROM feedback_messages m WHERE m.feedback_id = f.id
                 ORDER BY m.created_at DESC LIMIT 1) AS last_msg_text
         FROM feedback f
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.id`
      );
      return res.json(rows);
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
