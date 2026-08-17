// ВРЕМЕННЫЙ diag-роут для ежедневного AI-обхода (daily-v1118). Анонимный
// (без auth) — доступ только по секрету в query. Удалить сразу после обхода.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1118-4f7a2e9c1b6d8305aef2';

router.get('/daily-v1118', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
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
        server_now: new Date().toISOString(),
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT id, feedback_id, title, status, risk, admin_decision_by, admin_decision_at, created_at, updated_at FROM ai_proposals WHERE status = ? ORDER BY id`, status)
        : await db.all(`SELECT id, feedback_id, title, status, risk, admin_decision_by, admin_decision_at, created_at, updated_at FROM ai_proposals ORDER BY id`);
      return res.json({ data: rows });
    }
    if (op === 'proposal-thread') {
      const id = req.query.id;
      const rows = await db.all(`SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`, id);
      return res.json({ data: rows });
    }
    if (op === 'list-feedback') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT id, user_id, category, subject, status, created_at, updated_at FROM feedback WHERE status = ? ORDER BY updated_at DESC`, status)
        : await db.all(`SELECT id, user_id, category, subject, status, created_at, updated_at FROM feedback ORDER BY updated_at DESC`);
      return res.json({ data: rows });
    }
    if (op === 'feedback-thread') {
      const id = req.query.id;
      const f = await db.get(`SELECT f.*, u.name AS user_name, u.email AS user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`, id);
      const msgs = await db.all(`SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at`, id);
      return res.json({ feedback: f, messages: msgs });
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const u = await db.get(`SELECT id, email, name, role, active, updated_at FROM users WHERE email = ?`, email);
      return res.json({ user: u || null });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/daily-v1118', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op;
  const body = req.body || {};
  try {
    if (op === 'post-proposal-message') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?, ?, 'admin', ?)`,
        body.id, 'AI ассистент', body.text,
      );
      return res.json({ ok: true });
    }
    if (op === 'decide-proposal') {
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, body.decision, body.id);
      return res.json({ ok: true });
    }
    if (op === 'post-feedback-message') {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?, ?, 'admin', ?)`,
        body.id, 'AI ассистент', body.text,
      );
      return res.json({ ok: true });
    }
    if (op === 'set-feedback-status') {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        body.status, body.admin_reply || null, body.id,
      );
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
