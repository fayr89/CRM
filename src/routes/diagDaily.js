// Временный диагностический эндпоинт для ежедневного обхода AI (v1338).
// Анонимный (auth через секрет в query). Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1338-6d1f9c72ae4b0357';

router.get('/daily-v1338', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';

  try {
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
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at`
          : `SELECT * FROM ai_proposals WHERE status != 'done' ORDER BY created_at`,
        ...(status ? [status] : []),
      );
      return res.json({ proposals: rows });
    }

    if (op === 'search-proposals') {
      const q = req.query.q ? String(req.query.q) : '';
      if (!q) return res.status(400).json({ error: 'q required' });
      const rows = await db.all(
        `SELECT id, title, status, risk, feedback_id, created_at, updated_at
         FROM ai_proposals WHERE title ILIKE ? OR summary ILIKE ?
         ORDER BY created_at DESC LIMIT 20`,
        `%${q}%`, `%${q}%`,
      );
      return res.json({ proposals: rows });
    }

    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ messages });
    }

    if (op === 'list-feedback') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
             FROM feedback f LEFT JOIN users u ON u.id = f.user_id
             WHERE f.status = ? ORDER BY f.id`
          : `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
             FROM feedback f LEFT JOIN users u ON u.id = f.user_id
             WHERE f.status IN ('open','awaiting_approval') ORDER BY f.id`,
        ...(status ? [status] : []),
      );
      return res.json({ feedback: rows });
    }

    if (op === 'search-feedback') {
      const q = req.query.q ? String(req.query.q) : '';
      if (!q) return res.status(400).json({ error: 'q required' });
      const rows = await db.all(
        `SELECT id, title, status, created_at, updated_at
         FROM feedback WHERE title ILIKE ? OR text ILIKE ?
         ORDER BY created_at DESC LIMIT 20`,
        `%${q}%`, `%${q}%`,
      );
      return res.json({ feedback: rows });
    }

    if (op === 'feedback-thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ messages });
    }

    if (op === 'check-user') {
      const email = req.query.email ? String(req.query.email) : null;
      if (!email) return res.status(400).json({ error: 'email required' });
      const row = await db.get(
        `SELECT id, email, role, active, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ user: row || null });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

export default router;
