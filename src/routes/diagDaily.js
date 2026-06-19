// ВРЕМЕННЫЙ эндпоинт для AI daily-run — удалить сразу после использования!
// Секрет: m3n8q1zv5w (одноразовый, не использовать повторно).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'm3n8q1zv5w';

router.get('/daily-m3n8q1zv5w', async (req, res) => {
  if (req.query.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    // proposals: approved, revision, rejected, pending
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.status AS feedback_status,
              f.user_id AS feedback_user_id, fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

    // proposal threads
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }

    // feedback: open + awaiting_approval
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at ASC`,
    );

    // feedback threads
    const fbIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (fbIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }

    res.json({
      proposals,
      proposalMessages,
      feedback,
      feedbackMessages,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
