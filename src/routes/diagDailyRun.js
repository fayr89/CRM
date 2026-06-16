// TEMP: ежедневный обход AI — одноразовый диагностический эндпоинт.
// Возвращает ai_proposals (все статусы) + feedback (open/awaiting_approval) с тредами.
// Снести немедленно после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

const SECRET = 'dr28-x9k2m-7pqr';

router.get('/daily-run', asyncHandler(async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  // AI-proposals всех статусов, кроме done
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     WHERE p.status != 'done'
     ORDER BY p.created_at DESC
     LIMIT 100`,
  );

  // Треды для каждого proposal
  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  // Обращения в open и awaiting_approval
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.updated_at DESC
     LIMIT 100`,
  );

  // Треды для каждого feedback
  const feedbackMessages = {};
  for (const f of feedbacks) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      f.id,
    );
    feedbackMessages[f.id] = msgs;
  }

  res.json({
    proposals,
    proposalMessages,
    feedbacks,
    feedbackMessages,
  });
}));

export default router;
