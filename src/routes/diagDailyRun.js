// TEMPORARY: ежедневный диаг-обход AI. УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ.
// Token: p7xk91
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'p7xk91';

// Fake admin user for write operations
const AI_USER = { id: null, role: 'admin', name: 'AI ассистент' };

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });

    const op = req.query.op || 'help';

    // ── READ: list proposals by status ──────────────────────────
    if (op === 'proposals') {
      const status = req.query.status;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                p.status, p.admin_notes, p.feedback_id, p.proposed_changes,
                p.created_at, p.updated_at, p.admin_decision_at,
                f.subject AS feedback_subject
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows, total: rows.length });
    }

    // ── READ: messages for a proposal ───────────────────────────
    if (op === 'proposal_messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = $1
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // ── READ: all open/awaiting_approval feedback with latest message ──
    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.id, f.subject, f.message, f.category, f.status,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC`,
      );
      return res.json({ data: rows, total: rows.length });
    }

    // ── READ: messages for a feedback thread ────────────────────
    if (op === 'feedback_thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = $1
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // ── WRITE: mark proposal done ────────────────────────────────
    if (op === 'mark_done') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', admin_decision_at = NOW(), updated_at = NOW() WHERE id = $1`,
        id,
      );
      return res.json({ ok: true, id });
    }

    // ── WRITE: post message to proposal thread ───────────────────
    if (op === 'post_proposal_msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, $2, $3, $4, $5)`,
        id, AI_USER.id, 'AI ассистент', 'admin', text,
      );
      return res.json({ ok: true });
    }

    // ── WRITE: create ai_proposal ────────────────────────────────
    if (op === 'create_proposal') {
      const title = req.query.title ? decodeURIComponent(req.query.title) : null;
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : null;
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source ? decodeURIComponent(req.query.source) : null;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.changes ? decodeURIComponent(req.query.changes) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        proposed_changes || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // ── WRITE: post message to feedback thread ───────────────────
    if (op === 'post_fb_msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = $1', id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, $2, $3, $4, $5)`,
        id, AI_USER.id, 'AI ассистент', 'admin', text,
      );
      return res.json({ ok: true });
    }

    // ── WRITE: update feedback status and/or admin_reply ────────
    if (op === 'update_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const reply = req.query.reply ? decodeURIComponent(req.query.reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (!status && !reply) return res.status(400).json({ error: 'status or reply required' });
      const cur = await db.get('SELECT id, status, user_id FROM feedback WHERE id = $1', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET
           status = $1,
           admin_reply = COALESCE($2, admin_reply),
           resolved_by = CASE WHEN $1 IN ('awaiting_approval','closed') AND $3 NOT IN ('awaiting_approval','closed') THEN $4 ELSE resolved_by END,
           resolved_at = CASE WHEN $1 IN ('awaiting_approval','closed') AND $3 NOT IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = $5`,
        newStatus, reply, cur.status, AI_USER.id, id,
      );
      return res.json({ ok: true, id, status: newStatus });
    }

    // ── WRITE: rewrite/update a pending proposal ─────────────────
    if (op === 'update_proposal') {
      const id = Number(req.query.id);
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : null;
      const title = req.query.title ? decodeURIComponent(req.query.title) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (!summary && !title) return res.status(400).json({ error: 'summary or title required' });
      const sets = [];
      const params = [];
      let pIdx = 1;
      if (title) { sets.push(`title = $${pIdx++}`); params.push(title); }
      if (summary) { sets.push(`summary = $${pIdx++}`); params.push(summary); }
      sets.push(`status = 'pending'`);
      sets.push(`updated_at = NOW()`);
      params.push(id);
      await db.run(
        `UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = $${pIdx}`,
        ...params,
      );
      return res.json({ ok: true, id });
    }

    return res.json({ op: 'unknown', available: ['proposals','proposal_messages','feedback','feedback_thread','mark_done','post_proposal_msg','create_proposal','post_fb_msg','update_feedback','update_proposal'] });
  }),
);

export default router;
