// TEMP diag endpoint for AI daily run 2026-07-02-v69. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v69-16140a884b712ae8ad925cb5';

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

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.json({ ok: false, error: String(e && e.message || e) });
  }
});

export default router;
