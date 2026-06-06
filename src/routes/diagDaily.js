// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const DIAG_SECRET = 'xK9mP2vQ7nR4wL8jY5hT3cE6bF1dA0';

router.get('/daily-data', async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const [proposals_approved, proposals_revision, proposals_rejected, proposals_pending, feedbacks] = await Promise.all([
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'approved' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'revision' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'rejected' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'pending' ORDER BY p.updated_at DESC`),
      db.all(`SELECT f.*, u.name AS author_name, u.email AS author_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.updated_at DESC LIMIT 100`),
    ]);

    const allProposalIds = [
      ...proposals_approved,
      ...proposals_revision,
      ...proposals_rejected,
      ...proposals_pending,
    ].map(p => p.id);

    let proposalMessages = {};
    if (allProposalIds.length > 0) {
      const msgs = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY($1::int[]) ORDER BY created_at ASC, id ASC`,
        allProposalIds,
      );
      for (const m of msgs) {
        if (!proposalMessages[m.proposal_id]) proposalMessages[m.proposal_id] = [];
        proposalMessages[m.proposal_id].push(m);
      }
    }

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackThreads = {};
    if (feedbackIds.length > 0) {
      const threads = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY($1::int[]) ORDER BY created_at ASC, id ASC`,
        feedbackIds,
      );
      for (const t of threads) {
        if (!feedbackThreads[t.feedback_id]) feedbackThreads[t.feedback_id] = [];
        feedbackThreads[t.feedback_id].push(t);
      }
    }

    res.json({
      proposals: {
        approved: proposals_approved.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        revision: proposals_revision.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        rejected: proposals_rejected.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        pending: proposals_pending.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
      },
      feedbacks: feedbacks.map(f => ({ ...f, thread: feedbackThreads[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
