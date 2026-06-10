// ВРЕМЕННЫЙ диагностический эндпоинт для AI-обхода обращений (daily run).
// ОБЯЗАТЕЛЬНО удалить отдельным коммитом сразу после использования.
// Все операции — GET, тело передаётся через payload=base64(JSON).
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'd10-Xk7nP2qMv9-daily';
const router = Router();

function ok(res, data) { res.json({ ok: true, ...data }); }
function err(res, msg, status = 400) { res.status(status).json({ ok: false, error: msg }); }

function dec(s) {
  if (!s) return {};
  try { return JSON.parse(Buffer.from(decodeURIComponent(s), 'base64').toString('utf8')); }
  catch { return {}; }
}

router.get('/', async (req, res) => {
  if (req.query.s !== SECRET) return err(res, 'forbidden', 403);

  const { action, id, payload } = req.query;

  try {
    // ── READ ALL ──────────────────────────────────────────────────────────────
    if (action === 'read_all') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ORDER BY (CASE p.status
           WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
           WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
           p.created_at DESC
         LIMIT 100`,
      );

      const proposalMessages = {};
      for (const p of proposals) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
        proposalMessages[p.id] = msgs;
      }

      const feedback = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC LIMIT 100`,
      );

      const feedbackMessages = {};
      for (const f of feedback) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          f.id,
        );
        feedbackMessages[f.id] = msgs;
      }

      return ok(res, { proposals, proposalMessages, feedback, feedbackMessages });
    }

    // ── MARK PROPOSAL DONE ────────────────────────────────────────────────────
    if (action === 'proposal_done') {
      if (!id) return err(res, 'id required');
      await db.run(
        `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`,
        Number(id),
      );
      return ok(res, { id: Number(id), status: 'done' });
    }

    // ── PATCH PROPOSAL STATUS (revision → pending) ────────────────────────────
    if (action === 'proposal_patch') {
      if (!id) return err(res, 'id required');
      const data = dec(payload);
      const { status, summary, proposed_changes } = data;
      if (!status) return err(res, 'status required');
      await db.run(
        `UPDATE ai_proposals SET status=?, summary=COALESCE(?,summary),
         proposed_changes=COALESCE(?::jsonb,proposed_changes), updated_at=NOW()
         WHERE id=?`,
        status,
        summary ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
        Number(id),
      );
      return ok(res, { id: Number(id), status });
    }

    // ── CREATE PROPOSAL ───────────────────────────────────────────────────────
    if (action === 'proposal_create') {
      const data = dec(payload);
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = data;
      if (!title || !summary) return err(res, 'title and summary required');
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
        feedback_id ?? null,
        title,
        summary,
        category ?? null,
        risk || 'medium',
        source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return ok(res, { id: r.lastInsertRowid });
    }

    // ── POST MESSAGE TO PROPOSAL THREAD ──────────────────────────────────────
    if (action === 'proposal_message') {
      if (!id) return err(res, 'id required');
      const data = dec(payload);
      const { text } = data;
      if (!text) return err(res, 'text required');
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(id),
        text,
      );
      return ok(res, { id: r.lastInsertRowid });
    }

    // ── UPDATE FEEDBACK STATUS ────────────────────────────────────────────────
    if (action === 'feedback_update') {
      if (!id) return err(res, 'id required');
      const data = dec(payload);
      const { status, admin_reply } = data;
      if (!status) return err(res, 'status required');
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=COALESCE(?,admin_reply), updated_at=NOW()
         WHERE id=?`,
        status,
        admin_reply ?? null,
        Number(id),
      );
      return ok(res, { id: Number(id), status });
    }

    // ── POST MESSAGE TO FEEDBACK THREAD ──────────────────────────────────────
    if (action === 'feedback_message') {
      if (!id) return err(res, 'id required');
      const data = dec(payload);
      const { text } = data;
      if (!text) return err(res, 'text required');
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
        Number(id),
        text,
      );
      return ok(res, { id: r.lastInsertRowid });
    }

    return err(res, `unknown action: ${action}`);
  } catch (e) {
    return err(res, e.message, 500);
  }
});

export default router;
