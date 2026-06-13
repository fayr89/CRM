// TEMP: одноразовый диагностический эндпоинт для AI ежедневного обхода.
// Возвращает ai_proposals и feedback с тредами. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DIAG_SECRET = 'x7r2p9k4w1n8';

router.use((req, res, next) => {
  if (req.query?.diag_token !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

router.get('/daily-data', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ORDER BY p.created_at DESC
     LIMIT 200`,
  );

  const proposalMessages = proposals.length
    ? await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposals.map((p) => p.id).join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      )
    : [];

  const feedbacks = await db.all(
    `SELECT f.*, u.name AS author_name, u.email AS author_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 200`,
  );

  const feedbackMessages = feedbacks.length
    ? await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbacks.map((f) => f.id).join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      )
    : [];

  res.json({
    proposals,
    proposal_messages: proposalMessages,
    feedbacks,
    feedback_messages: feedbackMessages,
  });
}));

export default router;
