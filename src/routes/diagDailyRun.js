// TEMP: одноразовый диаг-эндпоинт для ежедневного AI-обхода обращений.
// Секрет: ?secret=f8n2x5q7r3k1 — никогда не коммитить с реальным секретом.
// Сносится СРАЗУ после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'f8n2x5q7r3k1';

function guard(req, res, next) {
  if (req.query?.secret === SECRET) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// GET /api/diag/daily-run?secret=... → ai_proposals + feedback с тредами
router.get(
  '/daily-run',
  guard,
  asyncHandler(async (_req, res) => {
    // AI-предложения по нужным статусам + тред каждого
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

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

    // Обращения в активных статусах + треды
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC`,
    );

    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    res.json({
      proposals,
      proposal_messages: proposalMessages,
      feedbacks,
      feedback_messages: feedbackMessages,
    });
  }),
);

export default router;
