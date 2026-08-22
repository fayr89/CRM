// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода (daily-v1220).
// Только чтение, доступ по секрету в query. Удаляется после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1220-9c4f2b71';

router.get('/', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS c FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS c FROM feedback GROUP BY status`
      );
      const proposalsLast = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackLast = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      return res.json({
        server_now: new Date().toISOString(),
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.c])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.c])),
        proposals_last_update: proposalsLast?.t,
        feedback_last_msg: feedbackLast?.t,
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = await db.all(
        `SELECT id, title, status, risk, feedback_id, admin_decision_by, admin_decision_at, admin_notes, created_at, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY id`,
        status
      );
      return res.json(rows);
    }
    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY id`,
        id
      );
      return res.json(rows);
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get(
        `SELECT id, email, active, updated_at FROM users WHERE email = ?`,
        email
      );
      return res.json(row || null);
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
