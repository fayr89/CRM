// TEMP: ежедневный AI-обход. Удалить сразу после использования.
// Отдаёт JWT + все нужные данные за один запрос.
import { Router } from 'express';
import { db } from '../db.js';
import { signToken } from '../auth.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr-2026-06-11-tvkj8g';

router.get(
  '/daily-run',
  asyncHandler(async (req, res) => {
    if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });

    const admin = await db.get(
      `SELECT id, email, name, role FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1`,
    );
    if (!admin) return res.status(503).json({ error: 'no admin user' });

    const token = signToken(admin);

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const feedbackIds = feedbacks.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    const pmByProposal = {};
    for (const m of proposalMessages) {
      if (!pmByProposal[m.proposal_id]) pmByProposal[m.proposal_id] = [];
      pmByProposal[m.proposal_id].push(m);
    }

    const fmByFeedback = {};
    for (const m of feedbackMessages) {
      if (!fmByFeedback[m.feedback_id]) fmByFeedback[m.feedback_id] = [];
      fmByFeedback[m.feedback_id].push(m);
    }

    res.json({
      token,
      proposals: proposals.map((p) => ({ ...p, messages: pmByProposal[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: fmByFeedback[f.id] || [] })),
    });
  }),
);

export default router;
