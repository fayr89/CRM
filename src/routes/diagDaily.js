import express from 'express';
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1113-4e7c9a2f1b6d80c53af9';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(`SELECT status, COUNT(*)::int AS c FROM ai_proposals GROUP BY status`);
      const feedbackByStatus = await db.all(`SELECT status, COUNT(*)::int AS c FROM feedback GROUP BY status`);
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS m FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS m FROM feedback_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.c])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map(r => [r.status, r.c])),
        proposals_last_update: proposalsLastUpdate.m,
        feedback_last_msg: feedbackLastMsg.m,
        server_now: new Date().toISOString(),
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT id, title, status, risk, feedback_id, admin_decision_by, admin_decision_at, created_at, updated_at FROM ai_proposals WHERE status = ? ORDER BY id`, [status])
        : await db.all(`SELECT id, title, status, risk, feedback_id, admin_decision_by, admin_decision_at, created_at, updated_at FROM ai_proposals ORDER BY id`);
      return res.json(rows);
    }
    if (op === 'proposal-thread') {
      const id = req.query.id;
      const rows = await db.all(`SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`, [id]);
      return res.json(rows);
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const rows = await db.all(`SELECT id, email, active, updated_at FROM users WHERE email = ?`, [email]);
      return res.json(rows);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
