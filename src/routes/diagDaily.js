import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'v1230-9d4f27ea';

router.get('/daily-v1230', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  try {
    const op = req.query.op || 'meta';

    if (op === 'meta') {
      const proposalsByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`);
      const feedbackByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`);
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const feedbackOpenCount = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status IN ('open','awaiting_approval')`);
      return res.json({
        proposals_total: proposalsTotal.n,
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map(r => [r.status, r.n])),
        feedback_open_count: feedbackOpenCount.n,
        proposals_last_update: proposalsLastUpdate.t,
        feedback_last_msg: feedbackLastMsg.t,
        server_now: new Date().toISOString(),
      });
    }

    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT id, title, status, risk, feedback_id, admin_decision_by, admin_decision_at, admin_notes, created_at, updated_at FROM ai_proposals WHERE status = ? ORDER BY id`, status)
        : await db.all(`SELECT id, title, status, risk, feedback_id, admin_decision_by, admin_decision_at, admin_notes, created_at, updated_at FROM ai_proposals ORDER BY id`);
      return res.json({ rows });
    }

    if (op === 'proposal-thread') {
      const id = req.query.id;
      const rows = await db.all(`SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`, id);
      return res.json({ rows });
    }

    if (op === 'list-feedback') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT id, subject, category, status, updated_at, created_at FROM feedback WHERE status = ? ORDER BY updated_at DESC`, status)
        : await db.all(`SELECT id, subject, category, status, updated_at, created_at FROM feedback ORDER BY updated_at DESC`);
      return res.json({ rows });
    }

    if (op === 'feedback-thread') {
      const id = req.query.id;
      const rows = await db.all(`SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at`, id);
      return res.json({ rows });
    }

    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get(`SELECT id, email, active, updated_at FROM users WHERE email = ?`, email);
      return res.json({ row: row || null });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
