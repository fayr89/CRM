// TEMP diag endpoint for AI daily run 2026-07-09-v232. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ad95ca9e74f007eddc95c2751f5ca426';

router.use(async (req, res, next) => {
  const secret = req.query.secret || req.body?.secret;
  if (secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', async (req, res) => {
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

    if (op === 'get-proposal-messages') {
      const id = Number(p('id'));
      if (!id) return res.json({ ok: false, error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'get-feedback') {
      const statuses = (p('status') || 'open,awaiting_approval').split(',');
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

    if (op === 'patch-proposal') {
      const id = Number(p('id'));
      const decision = p('decision');
      const admin_notes = p('admin_notes');
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      if (admin_notes !== undefined) {
        await db.run(
          `UPDATE ai_proposals SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3`,
          decision,
          admin_notes,
          id,
        );
      } else {
        await db.run(`UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`, decision, id);
      }
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = $1', id) });
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
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
        proposed_changes,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid) });
    }

    if (op === 'post-proposal-msg') {
      const id = Number(p('id'));
      const text = p('text');
      if (!id || !text) return res.json({ ok: false, error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = $1', id);
      if (!cur) return res.json({ ok: false, error: 'proposal not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, NULL, 'AI ассистент', 'admin', $2) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE id = $1', r.lastInsertRowid) });
    }

    if (op === 'post-feedback-msg') {
      const feedback_id = Number(p('feedback_id'));
      const text = p('text');
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

    if (op === 'patch-feedback') {
      const feedback_id = Number(p('feedback_id'));
      const status = p('status');
      const admin_reply = p('admin_reply');
      if (!feedback_id || !status) return res.json({ ok: false, error: 'feedback_id and status required' });
      if (admin_reply !== undefined) {
        await db.run(
          `UPDATE feedback SET status = $1, admin_reply = $2, updated_at = NOW() WHERE id = $3`,
          status,
          admin_reply,
          feedback_id,
        );
      } else {
        await db.run(`UPDATE feedback SET status = $1, updated_at = NOW() WHERE id = $2`, status, feedback_id);
      }
      return res.json({ ok: true, data: await db.get('SELECT * FROM feedback WHERE id = $1', feedback_id) });
    }

    if (op === 'meta') {
      const branches = await db.get(
        `SELECT
           (SELECT COUNT(*) FROM ai_proposals) AS proposals_total,
           (SELECT MAX(updated_at) FROM ai_proposals) AS proposals_last_update,
           (SELECT MAX(created_at) FROM feedback_messages) AS feedback_last_msg,
           (SELECT COUNT(*) FROM feedback WHERE status IN ('open','awaiting_approval')) AS feedback_open_count
        `,
      );
      return res.json({ ok: true, data: branches });
    }

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
