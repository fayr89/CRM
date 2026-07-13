import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'daily-v312-4f8a1c';

router.get('/daily-v312', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      const feedbackOpenCount = await db.get(
        `SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`
      );
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate.t,
        feedback_last_msg: feedbackLastMsg.t,
        feedback_open_count: feedbackOpenCount.n,
        proposals_total: proposalsTotal.n,
      });
    }
    if (op === 'get-feedback-summary') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT row_to_json(m) FROM (
                   SELECT user_name, role, text, created_at
                   FROM feedback_messages WHERE feedback_id = f.id
                   ORDER BY created_at DESC LIMIT 1
                 ) m) AS last_msg
         FROM feedback f
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.id`
      );
      return res.json(rows);
    }
    if (op === 'proposals-by-status') {
      const status = req.query.status;
      const rows = await db.all(
        `SELECT id, title, status, risk, feedback_id, admin_notes, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY id`,
        [status]
      );
      return res.json(rows);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
});

export default router;
