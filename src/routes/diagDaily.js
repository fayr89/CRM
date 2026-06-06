// TEMP diag endpoint for AI daily run 2026-06-06-v66. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v66-Wm3kT-9sLp';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const op = req.query.op || 'get-all';

  try {
    // GET ALL DATA IN ONE CALL
    if (op === 'get-all') {
      const proposals = await db.all(
        `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
                p.feedback_id, p.admin_notes, p.created_at, p.updated_at,
                f.subject AS feedback_subject, f.status AS feedback_status
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                   WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                  p.created_at DESC`,
      );

      const feedbacks = await db.all(
        `SELECT f.id, f.status, f.subject, f.category, f.message, f.admin_reply,
                f.created_at, f.updated_at, f.user_id,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
      );

      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }

      for (const p of proposals) {
        p.messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }

      return res.json({ ok: true, proposals, feedbacks });
    }

    // WRITE: patch proposal status
    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true });
    }

    // WRITE: post proposal message
    if (op === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.json({ ok: false, error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    // WRITE: create proposal
    if (op === 'post-proposal') {
      const { title, summary, category, risk, source, feedback_id } = req.query;
      if (!title || !summary) return res.json({ ok: false, error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary,
        category || null,
        risk || 'medium',
        source || 'daily-run-2026-06-06',
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // WRITE: patch feedback status + admin_reply
    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      if (!id) return res.json({ ok: false, error: 'id required' });
      const parts = ['updated_at = NOW()'];
      const params = [];
      if (req.query.status) { parts.unshift('status = ?'); params.push(req.query.status); }
      if (req.query.reply) { parts.unshift('admin_reply = ?'); params.push(req.query.reply); }
      params.push(id);
      await db.run(`UPDATE feedback SET ${parts.join(', ')} WHERE id = ?`, ...params);
      return res.json({ ok: true });
    }

    // WRITE: post feedback thread message
    if (op === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.json({ ok: false, error: 'id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `unknown op: ${op}` });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[diag-daily]', e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
