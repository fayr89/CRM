// TEMP diag endpoint for AI daily run 2026-06-04-v23. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v23-8xKm2pWz';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const op = req.query.op;
  try {
    // ------- READ: proposals -------
    if (op === 'get-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                    f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             WHERE p.status = $1
             ORDER BY p.created_at DESC`,
            status,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                    f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             ORDER BY p.created_at DESC`,
          );
      return res.json({ ok: true, data: rows });
    }

    // ------- READ: feedback + threads -------
    if (op === 'get-feedback') {
      const statuses = (req.query.status || 'open,awaiting_approval').split(',');
      const ph = statuses.map((_, i) => `$${i + 1}`).join(', ');
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${ph})
         ORDER BY f.created_at DESC`,
        ...statuses,
      );
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ ok: true, data: feedbacks });
    }

    // ------- WRITE: mark proposal done -------
    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`,
        decision,
        id,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = $1', id) });
    }

    // ------- WRITE: create proposal -------
    if (op === 'post-proposal') {
      const { title, summary, category, risk, source } = req.query;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      if (!title || !summary) return res.json({ ok: false, error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, NULL) RETURNING id`,
        feedback_id,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid) });
    }

    // ------- WRITE: post thread message -------
    if (op === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!feedback_id || !text) return res.json({ ok: false, error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = $1', feedback_id);
      if (!fb) return res.json({ ok: false, error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, NULL, 'AI ассистент', 'admin', $2) RETURNING id`,
        feedback_id,
        text,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE id = $1', r.lastInsertRowid) });
    }

    // ------- WRITE: update feedback status/reply -------
    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.json({ ok: false, error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      if (!cur) return res.json({ ok: false, error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply), updated_at = NOW() WHERE id = $3`,
        newStatus,
        admin_reply,
        id,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, status, admin_reply, subject FROM feedback WHERE id = $1', id) });
    }

    res.json({ ok: false, error: 'unknown op', ops: ['get-proposals', 'get-feedback', 'patch-proposal', 'post-proposal', 'post-feedback-msg', 'patch-feedback'] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
