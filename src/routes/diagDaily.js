// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода.
// Удалить сразу после использования!
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const SECRET = 'diag-daily-run-2026-06-23-x7k9p2m4';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    // Все ai_proposals (approved / revision / rejected / pending)
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC`,
    );

    // Сообщения для каждого proposal
    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    // Все feedback в статусе open или awaiting_approval
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    // Треды для каждого feedback
    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
