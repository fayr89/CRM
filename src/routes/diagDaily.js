// TEMP — удалить после daily-run 2026-06-14-s51
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ds51-crm-ai-2026-0614-run';

router.get('/feedback-full', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    // Тред для каждого предложения
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    // Все открытые и ожидающие обращения
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    // Тред для каждого обращения
    for (const fb of feedbacks) {
      fb.thread = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    // Также получим закрытые обращения, связанные с proposals (для контекста)
    const closedWithProposals = await db.all(
      `SELECT f.id, f.subject, f.status, f.user_id,
              u.name AS user_name, p.id AS proposal_id, p.status AS proposal_status
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       JOIN ai_proposals p ON p.feedback_id = f.id
       WHERE f.status = 'closed' AND p.status NOT IN ('done')
       ORDER BY f.created_at DESC
       LIMIT 20`,
    );

    res.json({ proposals, feedbacks, closedWithProposals, generated_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
