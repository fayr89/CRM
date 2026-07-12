import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v300-9f1a3c';

router.get('/daily-v300', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*) FROM ai_proposals GROUP BY status`
      );
      const feedbackOpen = await db.get(`SELECT COUNT(*) FROM feedback WHERE status='open'`);
      const lastProposal = await db.get(`SELECT MAX(updated_at) AS max FROM ai_proposals`);
      const lastFeedbackMsg = await db.get(`SELECT MAX(created_at) AS max FROM feedback_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, Number(r.count)])),
        feedback_open_count: Number(feedbackOpen.count),
        proposals_last_update: lastProposal.max,
        feedback_last_msg: lastFeedbackMsg.max,
      });
    }
    if (op === 'get-proposals') {
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, category, admin_notes, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY id`,
        req.query.status
      );
      return res.json(rows);
    }
    if (op === 'get-proposal-messages') {
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at`,
        req.query.id
      );
      return res.json(rows);
    }
    if (op === 'get-feedback-summary') {
      const statuses = (req.query.status || 'open,awaiting_approval').split(',');
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT jsonb_build_object('user_name', m.user_name, 'role', m.role, 'created_at', m.created_at, 'text', left(m.text, 200))
                 FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM feedback f WHERE f.status = ANY(?) ORDER BY f.id`,
        statuses
      );
      return res.json(rows);
    }
    if (op === 'get-feedback') {
      const row = await db.get(
        `SELECT f.*, (SELECT json_agg(m.* ORDER BY m.created_at) FROM feedback_messages m WHERE m.feedback_id = f.id) AS messages
         FROM feedback f WHERE f.id = ?`,
        req.query.id
      );
      return res.json(row || null);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
