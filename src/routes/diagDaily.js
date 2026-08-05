// Временный diag-эндпоинт для ежедневного обхода AI (v829). Только GET, только
// агрегаты + чтение/запись тредов — секрет в query, не в auth-системе;
// сносится отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-v829-a19f1af740cad9ca55b9';

function decodeB64(s) {
  if (!s) return null;
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(404).json({ error: 'not found' });
    const op = String(req.query.op || 'meta');

    if (op === 'meta') {
      const proposalsByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`);
      const feedbackByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`);
      const lastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const lastProposalUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        feedback_last_msg: lastMsg?.t || null,
        proposals_last_update: lastProposalUpdate?.t || null,
      });
    }

    if (op === 'list-proposals') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals WHERE status = ? ORDER BY updated_at DESC`
          : `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals WHERE status != 'done' ORDER BY updated_at DESC`,
        ...(status ? [status] : []),
      );
      return res.json({ data: rows });
    }

    if (op === 'get-proposal') {
      const row = await db.get(
        `SELECT id, feedback_id, title, summary, category, risk, status, admin_notes, admin_decision_at, LENGTH(summary) AS summary_len
         FROM ai_proposals WHERE id = ?`,
        Number(req.query.id),
      );
      return res.json({ data: row || null });
    }

    if (op === 'get-proposal-messages') {
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        Number(req.query.id),
      );
      return res.json({ data: rows });
    }

    if (op === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = decodeB64(req.query.text_b64);
      if (!id || !text) return res.status(400).json({ error: 'id/text_b64 required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?, ?, 'admin', ?) RETURNING id`,
        id,
        'AI ассистент',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (op === 'decide-proposal') {
      const id = Number(req.query.id);
      const decision = String(req.query.decision || '');
      if (!id || !['approved', 'rejected', 'revision', 'done'].includes(decision)) {
        return res.status(400).json({ error: 'id/decision required' });
      }
      const notes = decodeB64(req.query.notes_b64);
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        notes,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'get-feedback-summary') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const rows = await db.all(
        `SELECT f.id, f.subject, f.status, f.category, f.created_at, u.name AS author_name
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status = ANY(?) ORDER BY f.created_at ASC`,
        statuses,
      );
      const out = [];
      for (const f of rows) {
        const last = await db.get(
          `SELECT role, user_name, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          f.id,
        );
        out.push({ ...f, last_message: last || null });
      }
      return res.json({ data: out });
    }

    if (op === 'get-feedback') {
      const id = Number(req.query.id);
      const fb = await db.get(
        `SELECT f.*, u.name AS author_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
        id,
      );
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: fb || null, messages });
    }

    if (op === 'post-feedback-message') {
      const id = Number(req.query.id);
      const text = decodeB64(req.query.text_b64);
      if (!id || !text) return res.status(400).json({ error: 'id/text_b64 required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?, ?, 'admin', ?) RETURNING id`,
        id,
        'AI ассистент',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (op === 'set-feedback-status') {
      const id = Number(req.query.id);
      const status = String(req.query.status || '');
      if (!id || !['open', 'in_progress', 'awaiting_approval', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'id/status required' });
      }
      const adminReply = decodeB64(req.query.admin_reply_b64);
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status,
        adminReply,
        id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
