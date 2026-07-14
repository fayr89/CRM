import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'daily-v325-7c2a91fe';

router.get('/diag/daily-v325', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatusReal = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatusReal.map(r => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.t,
        feedback_last_msg: feedbackLastMsg?.t,
      });
    }
    if (op === 'get-feedback-summary') {
      const rows = await db.all(`
        SELECT f.id, f.status, f.updated_at,
          (SELECT json_build_object('user_name', m.user_name, 'created_at', m.created_at, 'text', left(m.text, 200))
           FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
        FROM feedback f
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.id
      `);
      return res.json(rows);
    }
    if (op === 'get-proposals') {
      const status = req.query.status;
      const rows = await db.all(`SELECT * FROM ai_proposals WHERE status = $1 ORDER BY id`, [status]);
      return res.json(rows);
    }
    if (op === 'get-proposal-messages') {
      const id = req.query.id;
      const rows = await db.all(`SELECT * FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at`, [id]);
      return res.json(rows);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
