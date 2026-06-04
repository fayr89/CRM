// TEMP: daily AI-run diag endpoint. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'mZ5xQ2wP9nK4rJ7v';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

// GET /api/diag/daily-v18?secret=... — proposals + open feedback with threads
router.get('/', checkSecret, asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status IN ('pending','approved','revision','rejected')
     ORDER BY p.created_at DESC LIMIT 100`,
  );
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const fbIds = feedbacks.map(f => f.id);
  let messages = [];
  if (fbIds.length > 0) {
    messages = await db.all(
      `SELECT id, feedback_id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ANY(?::int[])
       ORDER BY created_at ASC, id ASC`,
      `{${fbIds.join(',')}}`,
    );
  }
  const threadMap = {};
  for (const m of messages) {
    (threadMap[m.feedback_id] = threadMap[m.feedback_id] || []).push(m);
  }
  const feedbacksWithThreads = feedbacks.map(f => ({ ...f, messages: threadMap[f.id] || [] }));
  res.json({ proposals, feedbacks: feedbacksWithThreads });
}));

// POST /api/diag/daily-v18/mark-done?secret=... — { id }
router.post('/mark-done', checkSecret, asyncHandler(async (req, res) => {
  const { id } = req.body;
  await db.run(
    `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`,
    id,
  );
  res.json({ ok: true, id });
}));

// POST /api/diag/daily-v18/feedback-patch?secret=... — { id, status, admin_reply? }
router.post('/feedback-patch', checkSecret, asyncHandler(async (req, res) => {
  const { id, status, admin_reply } = req.body;
  await db.run(
    `UPDATE feedback SET status=?, admin_reply=COALESCE(?,admin_reply),
     resolved_at=CASE WHEN ? IN ('awaiting_approval','closed') AND status NOT IN ('awaiting_approval','closed')
       THEN NOW() ELSE resolved_at END,
     updated_at=NOW() WHERE id=?`,
    status, admin_reply ?? null, status, id,
  );
  res.json({ ok: true, id });
}));

// POST /api/diag/daily-v18/post-message?secret=... — { feedback_id, text }
router.post('/post-message', checkSecret, asyncHandler(async (req, res) => {
  const { feedback_id, text } = req.body;
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    feedback_id, text,
  );
  res.json({ ok: true, message_id: r.lastInsertRowid });
}));

// POST /api/diag/daily-v18/create-proposal?secret=... — proposal fields
router.post('/create-proposal', checkSecret, asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary, category ?? null,
    risk || 'medium', source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// POST /api/diag/daily-v18/close-feedback?secret=... — { id, message? }
router.post('/close-feedback', checkSecret, asyncHandler(async (req, res) => {
  const { id, message } = req.body;
  if (message) {
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, message,
    );
  }
  await db.run(
    `UPDATE feedback SET status='closed', updated_at=NOW() WHERE id=?`,
    id,
  );
  res.json({ ok: true, id });
}));

export default router;
