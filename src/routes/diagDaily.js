import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'daily-v308-r7m4t';

router.get('/daily-v308', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS c FROM ai_proposals GROUP BY status`
      );
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS c FROM ai_proposals`);
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackOpenCount = await db.get(
        `SELECT COUNT(*)::int AS c FROM feedback WHERE status='open'`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.c])),
        proposals_total: proposalsTotal.c,
        proposals_last_update: proposalsLastUpdate.t,
        feedback_open_count: feedbackOpenCount.c,
        feedback_last_msg: feedbackLastMsg.t,
      });
    } else if (op === 'proposals') {
      const status = req.query.status;
      const rows = await db.all(
        `SELECT id, title, status, risk, category, feedback_id, updated_at FROM ai_proposals WHERE status=? ORDER BY id`,
        [status]
      );
      res.json(rows);
    } else if (op === 'proposal-messages') {
      const rows = await db.all(
        `SELECT id, user_name, text, created_at FROM ai_proposal_messages WHERE proposal_id=? ORDER BY created_at`,
        [req.query.id]
      );
      res.json(rows);
    } else if (op === 'get-feedback-summary') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.updated_at,
                (SELECT m.user_name FROM feedback_messages m WHERE m.feedback_id=f.id ORDER BY m.created_at DESC LIMIT 1) AS last_user,
                (SELECT m.created_at FROM feedback_messages m WHERE m.feedback_id=f.id ORDER BY m.created_at DESC LIMIT 1) AS last_at
         FROM feedback f
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.id`
      );
      res.json(rows);
    } else {
      res.status(400).json({ error: 'unknown op' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
