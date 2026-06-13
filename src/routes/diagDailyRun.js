// TEMP: диагностический эндпоинт для AI ежедневного обхода.
// Удалить после использования!
import { Router } from 'express';
import { db } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();
const SECRET = 'daily-run-2026-06-13-s34';

router.get('/data', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const admin = await db.get(`SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    if (!admin) return res.status(500).json({ error: 'no admin' });
    const token = signToken(admin);

    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.user_id AS feedback_user_id,
             fu.name AS feedback_author_name
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      LEFT JOIN users fu ON fu.id = f.user_id
      WHERE p.status IN ('approved','revision','rejected','pending')
      ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
               WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
               p.created_at DESC
      LIMIT 100
    `);

    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(`
        SELECT * FROM ai_proposal_messages
        WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
        ORDER BY proposal_id, created_at ASC, id ASC
      `);
    }

    const feedbacks = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.updated_at DESC
      LIMIT 100
    `);

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(`
        SELECT * FROM feedback_messages
        WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
        ORDER BY feedback_id, created_at ASC, id ASC
      `);
    }

    res.json({
      token,
      proposals,
      proposalMessages,
      feedbacks,
      feedbackMessages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
