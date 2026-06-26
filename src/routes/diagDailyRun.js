// ВРЕМЕННЫЙ диаг-эндпоинт для AI daily-run 2026-06-26-v10.
// Снести сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-daily-2026-06-26-v10-r8pQ';

router.get('/daily-run-v10', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // ai_proposals (all statuses except done) with messages
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status != 'done'
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    // messages for each proposal
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }
    // done proposals from last 2 days (in case we need to reference)
    const recentDone = await db.all(
      `SELECT id, title, status, feedback_id, updated_at
       FROM ai_proposals
       WHERE status = 'done' AND updated_at > NOW() - INTERVAL '2 days'
       ORDER BY updated_at DESC LIMIT 20`,
    );

    // feedback open/awaiting_approval with messages
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }

    const msgByProposal = {};
    for (const m of proposalMessages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }

    res.json({
      proposals: proposals.map(p => ({ ...p, messages: msgByProposal[p.id] || [] })),
      recent_done_proposals: recentDone,
      feedbacks: feedbacks.map(f => ({ ...f, messages: msgByFeedback[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
