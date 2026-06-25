// TEMP — daily AI обход 2026-06-25-v3. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr-2026-06-25-v3-xK9mP7qR';

router.get('/daily-full', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // Proposals по статусам
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ORDER BY p.created_at DESC LIMIT 100`,
    );

    // Треды для каждого proposal
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY created_at ASC`,
      );
    }

    // Feedback open + awaiting_approval + in_progress
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
              r.name AS resolved_by_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       LEFT JOIN users r ON r.id = f.resolved_by
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );

    // Треды обращений
    const feedbackIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY created_at ASC`,
      );
    }

    res.json({ proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
