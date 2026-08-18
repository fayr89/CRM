// TEMP: одноразовый диагностический роут для ежедневного обхода AI (v1142).
// Секрет в query, только GET (в т.ч. для write-операций — вызывается через
// web_fetch_vercel_url). Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'v1142_8bc236510deb23a7f2f1aedf1b9da0f45b8b99b9';

router.get(
  '/daily-v1142',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(404).json({ error: 'Route not found' });
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
      const where = req.query.status ? 'WHERE status = ?' : '';
      const params = req.query.status ? [String(req.query.status)] : [];
      const rows = await db.all(
        `SELECT id, feedback_id, title, summary, category, risk, source, status,
                admin_notes, admin_decision_by, admin_decision_at, created_at, updated_at
         FROM ai_proposals ${where} ORDER BY created_at ASC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (op === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '');
      if (!id || !text) return res.status(400).json({ error: 'id/text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id, created_at`,
        id,
        'AI ассистент',
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'create-proposal') {
      const { feedback_id, title, summary, category, risk, source } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title/summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        String(title),
        String(summary),
        category ? String(category) : null,
        risk ? String(risk) : 'medium',
        source ? String(source) : 'daily-run-2026-08-18-v1142',
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = String(req.query.decision || '');
      const notes = req.query.notes ? String(req.query.notes) : null;
      if (!id || !decision) return res.status(400).json({ error: 'id/decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
        decision,
        notes,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'list-feedback') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const placeholders = statuses.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT f.id, f.subject, f.status, f.category, f.created_at, f.updated_at,
                u.name AS user_name,
                (SELECT role FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_msg_role,
                (SELECT user_name FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_msg_user,
                (SELECT created_at FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_msg_at
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${placeholders})
         ORDER BY f.created_at ASC`,
        ...statuses,
      );
      return res.json({ data: rows });
    }

    if (op === 'feedback-thread') {
      const id = Number(req.query.id);
      const fb = await db.get(
        `SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
        id,
      );
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ feedback: fb, messages });
    }

    if (op === 'post-feedback-message') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '');
      if (!id || !text) return res.status(400).json({ error: 'id/text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id, created_at`,
        id,
        'AI ассистент',
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status ? String(req.query.status) : null;
      const adminReply = req.query.admin_reply ? String(req.query.admin_reply) : null;
      if (!id || (!status && !adminReply)) return res.status(400).json({ error: 'nothing to update' });
      await db.run(
        `UPDATE feedback SET status = COALESCE(?, status), admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status,
        adminReply,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'check-user') {
      const email = String(req.query.email || '');
      const row = await db.get(
        `SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ data: row || null });
    }

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
