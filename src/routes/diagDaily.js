// ВРЕМЕННЫЙ diag-эндпоинт для ежедневного обхода (v1216). Снести отдельным
// коммитом сразу после использования. Секрет — только для этого обхода.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'bc6889a0b427106ea28f360c637bffc40cdb37fd698e0032';

router.get('/daily-v1216', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  try {
    const op = req.query.op || 'meta';
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
        server_now: new Date().toISOString(),
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, category, admin_decision_by,
                admin_decision_at, admin_notes, created_at, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY id ASC`,
        status,
      );
      return res.json({ data: rows });
    }
    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC`,
        id,
      );
      return res.json({ data: rows });
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get(
        `SELECT id, email, role, active, created_at, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ data: row || null });
    }
    if (op === 'feedback-full') {
      const rows = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.status, f.user_id,
                u.name AS author_name, f.created_at, f.updated_at
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.updated_at DESC`,
      );
      const withThreads = [];
      for (const f of rows) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at ASC`,
          f.id,
        );
        withThreads.push({ ...f, messages: msgs });
      }
      return res.json({ data: withThreads });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
