// ВРЕМЕННЫЙ diag-эндпоинт для ежедневного обхода AI (2026-06-03).
// Удалить сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'diag-2026-06-03-k8z3p1';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/proposals?secret=... — proposals всех статусов
router.get('/proposals', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY p.created_at DESC
     LIMIT 200`,
  );
  res.json({ rows });
}));

// GET /api/diag/feedback-full?secret=... — open/awaiting_approval с тредами
router.get('/feedback-full', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS author_name
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.updated_at DESC
     LIMIT 100`,
  );
  const ids = feedbacks.map(r => r.id);
  let messages = [];
  if (ids.length) {
    messages = await db.all(
      `SELECT m.*, u.name AS sender_name
       FROM feedback_messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.feedback_id = ANY(?::int[])
       ORDER BY m.created_at ASC`,
      [ids],
    );
  }
  const msgMap = {};
  for (const m of messages) {
    if (!msgMap[m.feedback_id]) msgMap[m.feedback_id] = [];
    msgMap[m.feedback_id].push(m);
  }
  res.json({ feedbacks: feedbacks.map(f => ({ ...f, messages: msgMap[f.id] || [] })) });
}));

export default router;
