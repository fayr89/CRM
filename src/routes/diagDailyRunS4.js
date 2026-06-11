// TEMP: daily-run diag endpoint for AI feedback sweep 2026-06-11-s4
// DELETE THIS FILE after use (one-time secret, no auth bypass for prod routes)
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'drS4-2026-06-11-qumdhz-7x9k';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const action = req.query.action || '';

  try {
    // ── get-proposals ───────────────────────────────────────────────────────
    if (action === 'get-proposals') {
      const status = req.query.status || null;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    // ── get-proposal-messages ───────────────────────────────────────────────
    if (action === 'get-proposal-messages') {
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

    // ── patch-proposal ──────────────────────────────────────────────────────
    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = req.query.notes || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3`,
        decision, notes, id,
      );
      const updated = await db.get('SELECT * FROM ai_proposals WHERE id = $1', id);
      return res.json(updated);
    }

    // ── post-proposal ───────────────────────────────────────────────────────
    if (action === 'post-proposal') {
      const raw = req.query.b64;
      if (!raw) return res.status(400).json({ error: 'b64 required' });
      const data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk ?? 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    // ── post-proposal-msg ───────────────────────────────────────────────────
    if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, NULL, 'AI ассистент', 'admin', $2) RETURNING id, created_at`,
        id, text,
      );
      return res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    // ── get-feedback ────────────────────────────────────────────────────────
    if (action === 'get-feedback') {
      const statuses = ['open', 'awaiting_approval', 'in_progress'];
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status = ANY($1::text[])
         ORDER BY f.updated_at DESC`,
        statuses,
      );
      // fetch threads for each feedback
      const result = [];
      for (const row of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1
           ORDER BY created_at ASC, id ASC`,
          row.id,
        );
        result.push({ ...row, thread: msgs });
      }
      return res.json({ data: result });
    }

    // ── post-feedback-msg ───────────────────────────────────────────────────
    if (action === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.b64
        ? Buffer.from(req.query.b64, 'base64').toString('utf8')
        : req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, NULL, 'AI ассистент', 'admin', $2) RETURNING id, created_at`,
        id, text,
      );
      return res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    // ── patch-feedback ──────────────────────────────────────────────────────
    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply
        ? Buffer.from(req.query.admin_reply, 'base64').toString('utf8')
        : null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply),
         updated_at = NOW() WHERE id = $3`,
        status, admin_reply, id,
      );
      const updated = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      return res.json(updated);
    }

    return res.status(400).json({ error: 'unknown action', actions: [
      'get-proposals', 'get-proposal-messages', 'patch-proposal',
      'post-proposal', 'post-proposal-msg',
      'get-feedback', 'post-feedback-msg', 'patch-feedback',
    ] });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
