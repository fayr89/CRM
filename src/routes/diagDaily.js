// TEMP diag endpoint for AI daily run 2026-07-01-v41. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v41-3f8b6e12ad97c04d5b8a1e6f';

router.use(async (req, res, next) => {
  const secret = req.query.secret || req.body?.secret;
  if (secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

const handler = async (req, res) => {
  const op = req.query.op;
  const p = (key) => (req.query[key] !== undefined ? req.query[key] : req.body?.[key]);
  try {
    if (op === 'get-proposals') {
      const status = p('status');
      const rows = status
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                    f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             WHERE p.status = ?
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

    if (op === 'get-proposal-messages') {
      const id = Number(p('id'));
      if (!id) return res.json({ ok: false, error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'get-feedback') {
      const statuses = (p('status') || 'open,awaiting_approval').split(',');
      const ph = statuses.map(() => '?').join(', ');
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
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ ok: true, data: feedbacks });
    }

    if (op === 'get-audit') {
      const hours = Number(p('hours')) || 24;
      const rows = await db.all(
        `SELECT id, action, entity_type, entity_id, created_at
         FROM audit_log
         WHERE created_at > NOW() - ($1 || ' hours')::interval
         ORDER BY created_at DESC
         LIMIT 200`,
        String(hours),
      );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'patch-proposal') {
      const id = Number(p('id'));
      const decision = p('decision');
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision,
        id,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = ?', id) });
    }

    if (op === 'post-proposal') {
      const title = p('title');
      const summary = p('summary');
      const category = p('category');
      const risk = p('risk');
      const source = p('source');
      const feedback_id = p('feedback_id') ? Number(p('feedback_id')) : null;
      const proposed_changes_raw = p('proposed_changes');
      if (!title || !summary) return res.json({ ok: false, error: 'title and summary required' });
      const proposed_changes = proposed_changes_raw
        ? (typeof proposed_changes_raw === 'string' ? proposed_changes_raw : JSON.stringify(proposed_changes_raw))
        : null;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
        proposed_changes,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid) });
    }

    if (op === 'post-proposal-msg') {
      const id = Number(p('id'));
      const text = p('text');
      if (!id || !text) return res.json({ ok: false, error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.json({ ok: false, error: 'proposal not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, data: r });
    }

    if (op === 'post-feedback-msg') {
      const id = Number(p('id'));
      const text = p('text');
      if (!id || !text) return res.json({ ok: false, error: 'id and text required' });
      const cur = await db.get('SELECT id FROM feedback WHERE id = ?', id);
      if (!cur) return res.json({ ok: false, error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, data: r });
    }

    if (op === 'patch-feedback') {
      const id = Number(p('id'));
      const status = p('status');
      const admin_reply = p('admin_reply');
      if (!id || !status) return res.json({ ok: false, error: 'id and status required' });
      if (admin_reply !== undefined) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
          status,
          admin_reply,
          id,
        );
      } else {
        await db.run(`UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`, status, id);
      }
      return res.json({ ok: true, data: await db.get('SELECT * FROM feedback WHERE id = ?', id) });
    }

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

router.get('/', handler);
router.post('/', handler);

export default router;
