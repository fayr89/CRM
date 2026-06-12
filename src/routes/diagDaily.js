// TEMP: ежедневный обход AI — разовый diag. Снести сразу после получения данных.
// GET /api/diag/daily-run?s=<DAILY_SECRET>
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DAILY_SECRET = 'airun-2026-06-12-k9p3';

router.use((req, res, next) => {
  if (req.query?.s !== DAILY_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (_req, res) => {
  // ai_proposals всех статусов кроме done
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status != 'done'
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END),
              p.created_at DESC`,
  );

  // Треды для каждого предложения
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

  // Все feedback в open / awaiting_approval
  const feedbacks = await db.all(
    `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
            f.created_at, f.updated_at, u.name AS author_name, u.email AS author_email, u.role AS author_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at ASC`,
  );

  // Треды для каждого обращения
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

  res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
}));

export default router;
