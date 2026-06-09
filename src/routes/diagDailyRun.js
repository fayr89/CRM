// TEMP: ежедневный AI-обход 2026-06-09-v41. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'a3f7d2e9c1b4f8a3f7d2e9c1b4f8a3f7';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    // ai_proposals: все статусы кроме done
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved', 'rejected', 'revision', 'pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                p.created_at DESC
       LIMIT 100`,
    );

    // Треды для каждого предложения
    const proposalIds = proposals.map((p) => p.id);
    let msgByProposal = {};
    if (proposalIds.length) {
      const placeholders = proposalIds.map(() => '?').join(',');
      const messages = await db.all(
        `SELECT proposal_id, id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
        ...proposalIds,
      );
      for (const m of messages) {
        if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
        msgByProposal[m.proposal_id].push(m);
      }
    }

    // feedback: open + awaiting_approval + in_progress с тредами
    const feedbacks = await db.all(
      `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
              f.admin_reply, f.context, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at ASC
       LIMIT 100`,
    );
    const feedbackIds = feedbacks.map((f) => f.id);
    let fbMsgById = {};
    if (feedbackIds.length) {
      const fbPlaceholders = feedbackIds.map(() => '?').join(',');
      const fbMessages = await db.all(
        `SELECT feedback_id, id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id IN (${fbPlaceholders})
         ORDER BY created_at ASC, id ASC`,
        ...feedbackIds,
      );
      for (const m of fbMessages) {
        if (!fbMsgById[m.feedback_id]) fbMsgById[m.feedback_id] = [];
        fbMsgById[m.feedback_id].push(m);
      }
    }

    res.json({
      proposals: proposals.map((p) => ({
        ...p,
        messages: msgByProposal[p.id] || [],
      })),
      feedbacks: feedbacks.map((f) => ({
        ...f,
        thread: fbMsgById[f.id] || [],
      })),
    });
  }),
);

export default router;
