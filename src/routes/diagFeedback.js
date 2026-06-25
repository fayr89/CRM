// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'f7e2d1c4b9a3';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get(
  '/full',
  asyncHandler(async (_req, res) => {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ORDER BY p.id DESC
       LIMIT 200`,
    );

    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
  }),
);

export default router;
