// TEMP: ежедневный diag-эндпоинт для AI-обхода 2026-06-18 (удалить после use)
// Секрет одноразовый, передаётся в query: ?s=7x4qBe2wRfZ9
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7x4qBe2wRfZ9';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-run?s=... — все нужные данные для AI-обхода
router.get('/', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending, feedbackOpen] = await Promise.all([
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'approved' ORDER BY p.updated_at DESC`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'revision' ORDER BY p.updated_at DESC`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'rejected' ORDER BY p.updated_at DESC`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 30`),
    db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
            FROM feedback f LEFT JOIN users u ON u.id = f.user_id
            WHERE f.status IN ('open','awaiting_approval')
            ORDER BY f.created_at DESC LIMIT 50`),
  ]);

  // Подтягиваем треды feedback
  const feedbackIds = feedbackOpen.map(f => f.id);
  let feedbackMessages = [];
  if (feedbackIds.length) {
    feedbackMessages = await db.all(
      `SELECT fm.* FROM feedback_messages fm
       WHERE fm.feedback_id = ANY(?::int[])
       ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`,
      `{${feedbackIds.join(',')}}`,
    );
  }

  // Треды ai_proposals (approved + revision + pending)
  const proposalIds = [...approved, ...revision, ...pending, ...rejected].map(p => p.id);
  let proposalMessages = [];
  if (proposalIds.length) {
    proposalMessages = await db.all(
      `SELECT m.* FROM ai_proposal_messages m
       WHERE m.proposal_id = ANY(?::int[])
       ORDER BY m.proposal_id, m.created_at ASC, m.id ASC`,
      `{${proposalIds.join(',')}}`,
    );
  }

  res.json({
    ai_proposals: { approved, revision, rejected, pending },
    feedback: feedbackOpen,
    feedback_messages: feedbackMessages,
    proposal_messages: proposalMessages,
  });
}));

export default router;
