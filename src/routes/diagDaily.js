// TEMP: диагностический эндпоинт для ежедневного AI-обхода обращений.
// Удалить отдельным коммитом сразу после использования (см. AI-DAILY.md).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = '0dc44246601f2e9944d1';

router.get('/daily-v1157', async (req, res) => {
  if (req.query.k !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const proposalsLast = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLast = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const now = await db.get(`SELECT NOW() AS t`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLast?.t,
        feedback_last_msg: feedbackLast?.t,
        server_now: now?.t,
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = await db.all(
        status
          ? `SELECT id, feedback_id, title, status, risk, admin_decision_by, admin_decision_at, created_at, updated_at
             FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`
          : `SELECT id, feedback_id, title, status, risk, admin_decision_by, admin_decision_at, created_at, updated_at
             FROM ai_proposals ORDER BY created_at DESC`,
        ...(status ? [status] : []),
      );
      return res.json({ data: rows });
    }
    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }
    if (op === 'feedback-full') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.category, f.updated_at, f.created_at, u.name AS author_name
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.updated_at DESC`,
      );
      const withMsgs = [];
      for (const f of rows) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          f.id,
        );
        withMsgs.push({ ...f, messages: msgs });
      }
      return res.json({ data: withMsgs });
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get(
        `SELECT id, email, active, updated_at, created_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ data: row || null });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

export default router;
