// TEMP diag endpoint for AI daily run 2026-07-03-v71. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v71-8c9435742186cac0e23c9d58';

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

    if (op === 'get-feedback-summary') {
      const statuses = (p('status') || 'open,awaiting_approval').split(',');
      const ph = statuses.map((_, i) => `$${i + 1}`).join(', ');
      const feedbacks = await db.all(
        `SELECT f.id, f.category, f.subject, f.status, f.created_at, f.updated_at,
                u.name AS user_name, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${ph})
         ORDER BY f.created_at DESC`,
        ...statuses,
      );
      for (const fb of feedbacks) {
        const msgs = await db.all(
          `SELECT role, user_name, created_at FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        fb.message_count = msgs.length;
        fb.last_message = msgs.length ? msgs[msgs.length - 1] : null;
      }
      return res.json({ ok: true, data: feedbacks });
    }

    if (op === 'get-feedback-one') {
      const id = Number(p('id'));
      if (!id) return res.json({ ok: false, error: 'id required' });
      const fb = await db.get(
        `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.context, f.status,
                f.resolved_by, f.resolved_at, f.admin_reply, f.created_at, f.updated_at,
                (f.attachments IS NOT NULL) AS has_attachments,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = $1`,
        id,
      );
      if (!fb) return res.json({ ok: false, error: 'not found' });
      fb.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ ok: true, data: fb });
    }

    if (op === 'patch-proposal') {
      const id = Number(p('id'));
      const decision = p('decision');
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`,
        decision,
        id,
      );
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
        `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW(),NOW()) RETURNING id`,
        title, summary, category || 'other', risk || 'medium', source || 'daily-run', proposed_changes, feedback_id,
      );
      return res.json({ ok: true, data: r });
    }

    if (op === 'post-feedback-message') {
      const feedback_id = Number(p('feedback_id'));
      const text = p('text');
      const user_name = p('user_name') || 'AI ассистент';
      const role = p('role') || 'admin';
      if (!feedback_id || !text) return res.json({ ok: false, error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
         VALUES ($1, NULL, $2, $3, $4, NOW()) RETURNING id`,
        feedback_id, user_name, role, text,
      );
      return res.json({ ok: true, data: r });
    }

    if (op === 'post-proposal-message') {
      const proposal_id = Number(p('proposal_id'));
      const text = p('text');
      const user_name = p('user_name') || 'AI ассистент';
      const role = p('role') || 'admin';
      if (!proposal_id || !text) return res.json({ ok: false, error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text, created_at)
         VALUES ($1, NULL, $2, $3, $4, NOW()) RETURNING id`,
        proposal_id, user_name, role, text,
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
          `UPDATE feedback SET status = $1, admin_reply = $2, updated_at = NOW() WHERE id = $3`,
          status, admin_reply, id,
        );
      } else {
        await db.run(`UPDATE feedback SET status = $1, updated_at = NOW() WHERE id = $2`, status, id);
      }
      return res.json({ ok: true, data: await db.get('SELECT * FROM feedback WHERE id = $1', id) });
    }

    if (op === 'count-branches') {
      // no DB needed, just a marker op to confirm deploy version
      return res.json({ ok: true, data: { version: 'v71' } });
    }

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
