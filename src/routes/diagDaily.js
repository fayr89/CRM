import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v298-8f2a1c';

router.get('/daily-v298', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.query(
        `SELECT status, COUNT(*) FROM ai_proposals GROUP BY status`
      );
      const feedbackOpen = await db.query(`SELECT COUNT(*) FROM feedback WHERE status='open'`);
      const lastProposal = await db.query(`SELECT MAX(updated_at) FROM ai_proposals`);
      const lastFeedbackMsg = await db.query(`SELECT MAX(created_at) FROM feedback_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.rows.map(r => [r.status, Number(r.count)])),
        feedback_open_count: Number(feedbackOpen.rows[0].count),
        proposals_last_update: lastProposal.rows[0].max,
        feedback_last_msg: lastFeedbackMsg.rows[0].max,
      });
    }
    if (op === 'get-proposals') {
      const status = req.query.status;
      const r = await db.query(
        `SELECT id, feedback_id, title, status, risk, category, admin_notes, updated_at
         FROM ai_proposals WHERE status = $1 ORDER BY id`,
        [status]
      );
      return res.json(r.rows);
    }
    if (op === 'get-proposal-messages') {
      const r = await db.query(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = $1 ORDER BY created_at`,
        [req.query.id]
      );
      return res.json(r.rows);
    }
    if (op === 'get-feedback-summary') {
      const statuses = (req.query.status || 'open,awaiting_approval').split(',');
      const r = await db.query(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT jsonb_build_object('user_name', m.user_name, 'role', m.role, 'created_at', m.created_at, 'text', left(m.text, 200))
                 FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM feedback f WHERE f.status = ANY($1) ORDER BY f.id`,
        [statuses]
      );
      return res.json(r.rows);
    }
    if (op === 'get-feedback') {
      const r = await db.query(
        `SELECT f.*, (SELECT json_agg(m.* ORDER BY m.created_at) FROM feedback_messages m WHERE m.feedback_id = f.id) AS messages
         FROM feedback f WHERE f.id = $1`,
        [req.query.id]
      );
      return res.json(r.rows[0] || null);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
