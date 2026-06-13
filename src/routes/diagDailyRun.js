// TEMP: диагностический эндпоинт для AI ежедневного обхода.
// Удалить сразу после использования.
// Секрет: daily-run-2026-06-13-s26
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-run-2026-06-13-s26';

router.use((req, res, next) => {
  if (req.query?.secret === SECRET) return next();
  return res.status(403).json({ error: 'forbidden' });
});

router.get(
  '/full',
  asyncHandler(async (_req, res) => {
    // ai_proposals: approved/revision/rejected/pending — с тредами
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.status, p.created_at DESC`,
    );

    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    // feedback: open + awaiting_approval — с тредами
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    res.json({
      proposals,
      proposalMessages,
      feedbacks,
      feedbackMessages,
    });
  }),
);

export default router;
