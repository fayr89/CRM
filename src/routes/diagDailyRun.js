// TEMP: диагностика для AI ежедневного обхода. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const TOKEN = 'e7f3a9b2c5d1';

router.use((req, res, next) => {
  if (req.query?.t === TOKEN) return next();
  return res.status(403).json({ error: 'Forbidden' });
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const proposals = await db.all(
      `SELECT p.id, p.title, p.summary, p.category, p.risk, p.status,
              p.source, p.proposed_changes, p.feedback_id, p.admin_notes,
              p.created_at, p.updated_at,
              f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.status, p.created_at DESC`,
    );
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    const feedback = await db.all(
      `SELECT f.id, f.category, f.subject, f.message, f.status,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    for (const fb of feedback) {
      fb.messages = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    res.json({ proposals, feedback });
  }),
);

export default router;
