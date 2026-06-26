// TEMPORARY: daily-round diagnostic endpoint. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'pT4mZ9wR2kN6vXhQ';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const action = req.query.action || 'read';

  try {
    if (action === 'read') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ORDER BY p.created_at DESC
         LIMIT 100`,
      );
      for (const p of proposals) {
        p.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }

      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }

      return res.json({ proposals, feedbacks });
    }

    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !['approved', 'rejected', 'revision', 'done'].includes(decision)) {
        return res.status(400).json({ error: 'bad params' });
      }
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, id, decision });
    }

    if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    if (action === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    if (action === 'update-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        newStatus, admin_reply, id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST для длинных payload (summary, proposed_changes)
router.post('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const { action, ...body } = req.body || {};

  try {
    if (action === 'post-proposal') {
      const { title, summary, category = 'feature', risk = 'medium',
              source = 'daily-run-2026-06-26', feedback_id = null,
              proposed_changes = null } = body;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary, category, risk, source,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'post-proposal-msg') {
      const { id, text } = body;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        Number(id), text,
      );
      return res.json({ ok: true });
    }

    if (action === 'post-feedback-msg') {
      const { id, text } = body;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        Number(id), text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
