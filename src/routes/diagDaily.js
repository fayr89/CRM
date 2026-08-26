// ВРЕМЕННЫЙ диагностический роут для ежедневного обхода AI-ассистента.
// Секрет в query, доступ только GET (снаружи дёргается через web_fetch_vercel_url).
// Удалить сразу после использования — см. AI-DAILY.md.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v1322-9d3a6e1f4c7b0284';

router.get('/', async (req, res) => {
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
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      const feedbackOpenCount = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`);
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const serverNow = await db.get(`SELECT NOW() AS t`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map(r => [r.status, r.n])),
        proposals_total: proposalsTotal.n,
        feedback_open_count: feedbackOpenCount.n,
        proposals_last_update: proposalsLastUpdate.t,
        feedback_last_msg: feedbackLastMsg.t,
        server_now: serverNow.t,
      });
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(
          `SELECT id, feedback_id, title, category, risk, status, admin_notes,
                  admin_decision_by, admin_decision_at, created_at, updated_at
           FROM ai_proposals WHERE status = ? ORDER BY created_at ASC`,
          status,
        )
        : await db.all(
          `SELECT id, feedback_id, title, category, risk, status, admin_notes,
                  admin_decision_by, admin_decision_at, created_at, updated_at
           FROM ai_proposals ORDER BY created_at ASC`,
        );
      return res.json({ data: rows });
    }
    if (op === 'list-feedback') {
      const status = req.query.status;
      const statuses = status ? status.split(',') : ['open', 'awaiting_approval'];
      const placeholders = statuses.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
                f.created_at, f.updated_at, u.name AS user_name, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${placeholders})
         ORDER BY f.created_at ASC`,
        ...statuses,
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
    if (op === 'feedback-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }
    if (op === 'search-feedback') {
      const q = `%${req.query.q || ''}%`;
      const rows = await db.all(
        `SELECT DISTINCT f.id, f.subject, f.status, f.created_at
         FROM feedback f
         LEFT JOIN feedback_messages m ON m.feedback_id = f.id
         WHERE f.subject ILIKE ? OR f.message ILIKE ? OR m.text ILIKE ?
         ORDER BY f.created_at DESC LIMIT 20`,
        q, q, q,
      );
      return res.json({ data: rows });
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get(
        `SELECT id, name, role, active, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ data: row || null });
    }
    // --- write-операции: только GET (web_fetch_vercel_url не умеет POST), под тем же секретом ---
    if (op === 'proposal-set-status') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const notes = req.query.notes || null;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
        status, notes, id,
      );
      return res.json({ ok: true });
    }
    if (op === 'proposal-message') {
      const id = Number(req.query.id);
      const text = req.query.text;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'feedback-set-status') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply || null;
      const justResolved = status === 'awaiting_approval' || status === 'closed';
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = ?`,
        status, reply, id,
      );
      return res.json({ ok: true });
    }
    if (op === 'feedback-message') {
      const id = Number(req.query.id);
      const text = req.query.text;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'proposal-create') {
      const title = req.query.title;
      const category = req.query.category || 'bug';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || 'daily-run-2026-08-26';
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const summary = req.query.summary;
      const row = await db.get(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]'::jsonb, 'pending', NOW(), NOW()) RETURNING id`,
        title, summary, category, risk, source, feedbackId,
      );
      return res.json({ ok: true, id: row.id });
    }
    if (op === 'proposal-update-summary') {
      const id = Number(req.query.id);
      const summary = req.query.summary;
      await db.run(`UPDATE ai_proposals SET summary = ?, updated_at = NOW() WHERE id = ?`, summary, id);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
