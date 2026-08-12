// ВРЕМЕННЫЙ diag-роут для ежедневного обхода AI (v979). Только GET (тянется
// через web_fetch_vercel_url). Секрет в query. Сносится этим же обходом
// отдельным коммитом сразу после использования — см. AI-DAILY.md.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler, BadRequest, Forbidden } from '../errors.js';

const router = Router();

const SECRET = 'fdf6ede30bcd9a69b64b529f2d73f9e982974f4cd6d9684a';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) throw Forbidden('bad secret');
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const op = req.query.op;

    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS ts FROM feedback_messages`,
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS ts FROM ai_proposals`,
      );
      const proposalsLastMsg = await db.get(
        `SELECT MAX(created_at) AS ts FROM ai_proposal_messages`,
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        feedback_last_msg: feedbackLastMsg?.ts,
        proposals_last_update: proposalsLastUpdate?.ts,
        proposals_last_msg: proposalsLastMsg?.ts,
      });
    }

    if (op === 'list-proposals') {
      const statuses = String(req.query.status || 'pending,approved,revision,rejected').split(',');
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, category, updated_at, admin_notes
         FROM ai_proposals WHERE status = ANY(?) ORDER BY updated_at DESC`,
        statuses,
      );
      return res.json({ data: rows });
    }

    if (op === 'list-feedback') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const rows = await db.all(
        `SELECT f.id, f.category, f.subject, f.status, f.updated_at, f.created_at,
                u.name AS author_name
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status = ANY(?) ORDER BY f.updated_at DESC`,
        statuses,
      );
      return res.json({ data: rows });
    }

    if (op === 'feedback-full') {
      const id = Number(req.query.id);
      if (!id) throw BadRequest('id required');
      const fb = await db.get(
        `SELECT f.*, u.name AS author_name FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
        id,
      );
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ feedback: fb, messages });
    }

    if (op === 'proposal-full') {
      const id = Number(req.query.id);
      if (!id) throw BadRequest('id required');
      const p = await db.get(`SELECT * FROM ai_proposals WHERE id = ?`, id);
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ proposal: p, messages });
    }

    // --- Write ops (всё ещё HTTP GET — web_fetch_vercel_url умеет только GET,
    // но сама операция на сервере может писать в БД; см. AI-DAILY.md). ---

    if (op === 'feedback-message') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '');
      if (!id || !text.trim()) throw BadRequest('id/text required');
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        id,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'feedback-status') {
      const id = Number(req.query.id);
      const status = String(req.query.status || '');
      if (!id || !['open', 'in_progress', 'awaiting_approval', 'closed'].includes(status)) {
        throw BadRequest('id/status required');
      }
      const adminReply = req.query.admin_reply !== undefined ? String(req.query.admin_reply) : null;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
         updated_at = NOW() WHERE id = ?`,
        status,
        adminReply,
        status,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'proposal-message') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '');
      if (!id || !text.trim()) throw BadRequest('id/text required');
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        id,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'proposal-decision') {
      const id = Number(req.query.id);
      const decision = String(req.query.decision || '');
      if (!id || !['approved', 'rejected', 'revision', 'done'].includes(decision)) {
        throw BadRequest('id/decision required');
      }
      const notes = req.query.notes !== undefined ? String(req.query.notes) : null;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision,
        notes,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const title = String(req.query.title || '');
      const summary = String(req.query.summary || '');
      if (!title.trim() || !summary.trim()) throw BadRequest('title/summary required');
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedbackId,
        title,
        summary,
        req.query.category ? String(req.query.category) : 'other',
        req.query.risk ? String(req.query.risk) : 'medium',
        String(req.query.source || 'daily-run-2026-08-12'),
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    throw BadRequest('unknown op');
  }),
);

export default router;
