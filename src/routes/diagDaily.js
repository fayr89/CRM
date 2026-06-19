// TEMP — ежедневный AI-обход 2026-06-19 ntn3tm. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DIAG_SECRET = 'f9aba65890ed';

router.use((req, res, next) => {
  if (req.query?.s === DIAG_SECRET) return next();
  return res.status(403).json({ error: 'forbidden' });
});

router.get(
  '/all',
  asyncHandler(async (_req, res) => {
    // Все ai_proposals (approved, revision, rejected, pending) с тредами
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.status AS feedback_status,
              f.user_id AS feedback_user_id, fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY proposal_id, created_at ASC`,
      );
    }

    // Feedback: open и awaiting_approval с тредами
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    const feedbackIds = feedbacks.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY feedback_id, created_at ASC`,
      );
    }

    // Склеиваем треды к предложениям
    const msgByProposal = {};
    for (const m of proposalMessages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }

    // Склеиваем треды к feedback
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }

    res.json({
      proposals: proposals.map((p) => ({ ...p, messages: msgByProposal[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: msgByFeedback[f.id] || [] })),
    });
  }),
);

export default router;
