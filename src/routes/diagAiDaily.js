// TEMP: ежедневный AI-обход 2026-06-19 x5m3bw — удалить после использования
// Все write-операции через GET+action т.к. Vercel MCP поддерживает только GET.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'x5m3bw';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// action=list-proposals&status=approved|revision|rejected|pending
// action=get-proposal-msgs&id=X
// action=patch-proposal&id=X&decision=done|approved|rejected|revision&notes=...
// action=post-proposal-msg&id=X&text=URL-ENCODED
// action=create-proposal&feedback_id=X&title=...&summary=...&category=...&risk=...&source=...&changes=JSON
// action=list-feedback            — все open+awaiting_approval с тредами
// action=patch-feedback&id=X&status=Y&admin_reply=URL-ENCODED
// action=post-feedback-msg&id=X&text=URL-ENCODED

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action } = req.query;

    if (action === 'list-proposals') {
      const status = req.query.status || null;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (action === 'get-proposal-msgs') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = $1
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = req.query.notes ? decodeURIComponent(req.query.notes) : null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      const valid = ['approved', 'rejected', 'revision', 'done'];
      if (!valid.includes(decision)) return res.status(400).json({ error: 'invalid decision' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = $2,
         admin_decision_by = $3, admin_decision_at = NOW(), updated_at = NOW()
         WHERE id = $4`,
        decision, notes, 0, id,
      );
      const row = await db.get('SELECT * FROM ai_proposals WHERE id = $1', id);
      return res.json(row);
    }

    if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = $1', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        id, 0, 'AI ассистент', 'admin', text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'create-proposal') {
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const title = req.query.title ? decodeURIComponent(req.query.title) : '';
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : '';
      const category = req.query.category ? decodeURIComponent(req.query.category) : null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source ? decodeURIComponent(req.query.source) : null;
      const changes = req.query.changes ? req.query.changes : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedbackId, title, summary, category, risk, source, changes,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (action === 'list-feedback') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      const result = [];
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, messages: msgs });
      }
      return res.json({ data: result });
    }

    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const adminReply = req.query.admin_reply ? decodeURIComponent(req.query.admin_reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = $1,
           admin_reply = COALESCE($2, admin_reply),
           resolved_by = $3,
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = $4`,
        newStatus, adminReply, justResolved ? 0 : cur.resolved_by, id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = $1', id));
    }

    if (action === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = $1', id);
      if (!fb) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        id, 0, 'AI ассистент', 'admin', text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown action', actions: [
      'list-proposals', 'get-proposal-msgs', 'patch-proposal', 'post-proposal-msg',
      'create-proposal', 'list-feedback', 'patch-feedback', 'post-feedback-msg',
    ] });
  }),
);

export default router;
