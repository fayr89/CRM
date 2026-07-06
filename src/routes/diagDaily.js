// TEMP diag endpoint for AI daily run 2026-07-06-v151. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v151-Tn7wLp2Vf';

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

    return res.json({ ok: false, error: 'unknown op' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
