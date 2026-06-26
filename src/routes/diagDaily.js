// TEMPORARY: daily-round diagnostic endpoint. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'Rw4jP9mZ6xL2vH8n';

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
           FROM ai_proposal_messages WHERE proposal_id = $1
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
           FROM feedback_messages WHERE feedback_id = $1
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }

      return res.json({ proposals, feedbacks });
    }

    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !['approved', 'rejected', 'revision', 'done', 'pending'].includes(decision)) {
        return res.status(400).json({ error: 'bad params' });
      }
      await db.run(
        `UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`,
        decision, id,
      );
      return res.json({ ok: true, id, decision });
    }

    if (action === 'create-proposal') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || 'daily-run-2026-06-26-v8';
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes || null;

      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });

      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        proposed_changes ? JSON.stringify(JSON.parse(proposed_changes)) : null,
      );
      return res.json({ ok: true, id: r.rows?.[0]?.id || r.lastInsertRowid });
    }

    if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES ($1, 'AI ассистент', 'admin', $2)`,
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
         VALUES ($1, 'AI ассистент', 'admin', $2)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    if (action === 'update-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply),
         updated_at = NOW() WHERE id = $3`,
        newStatus, admin_reply, id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
