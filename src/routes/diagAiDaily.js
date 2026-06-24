// TEMP: диагностический роут для ежедневного обхода AI-ассистента.
// Удалить сразу после использования (отдельным коммитом).
// Секрет одноразовый — только для этой сессии.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'k9x4p2bw7m-daily-2026-06-24';

function checkSecret(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
}

// GET /api/diag/ai-daily?s=SECRET → все данные для обхода
router.get('/', checkSecret, asyncHandler(async (_req, res) => {
  // AI proposals по статусам
  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY p.created_at DESC LIMIT 200`,
  );
  const proposalIds = proposals.map(p => p.id);
  let proposalMessages = [];
  if (proposalIds.length) {
    proposalMessages = await db.all(
      `SELECT * FROM ai_proposal_messages
       WHERE proposal_id = ANY(?)
       ORDER BY created_at ASC, id ASC`,
      proposalIds,
    );
  }

  // Feedback в открытых статусах
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.created_at DESC LIMIT 200`,
  );
  const feedbackIds = feedbacks.map(f => f.id);
  let feedbackMessages = [];
  if (feedbackIds.length) {
    feedbackMessages = await db.all(
      `SELECT * FROM feedback_messages
       WHERE feedback_id = ANY(?)
       ORDER BY created_at ASC, id ASC`,
      feedbackIds,
    );
  }

  // Группируем
  const msgByProposal = {};
  for (const m of proposalMessages) {
    (msgByProposal[m.proposal_id] = msgByProposal[m.proposal_id] || []).push(m);
  }
  const msgByFeedback = {};
  for (const m of feedbackMessages) {
    (msgByFeedback[m.feedback_id] = msgByFeedback[m.feedback_id] || []).push(m);
  }

  res.json({
    ai_proposals: proposals.map(p => ({ ...p, thread: msgByProposal[p.id] || [] })),
    feedback: feedbacks.map(f => ({ ...f, thread: msgByFeedback[f.id] || [] })),
  });
}));

// POST /api/diag/ai-daily/feedback/:id/message?s=SECRET
router.post('/feedback/:id/message', checkSecret, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text, user_name } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
    id, user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/ai-daily/feedback/:id?s=SECRET → { status, admin_reply }
router.patch('/feedback/:id', checkSecret, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, admin_reply } = req.body;
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET
       status = ?,
       admin_reply = COALESCE(?, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at = NOW()
     WHERE id = ?`,
    newStatus, admin_reply ?? null, id,
  );
  res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id));
}));

// POST /api/diag/ai-daily/ai-proposals?s=SECRET → create
router.post('/ai-proposals', checkSecret, asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals
     (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary,
    category ?? null, risk || 'medium', source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/ai-daily/ai-proposals/:id?s=SECRET → { decision, notes }
router.patch('/ai-proposals/:id', checkSecret, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { decision, notes, summary, proposed_changes } = req.body;
  if (decision) {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
  } else {
    // revision rewrite: обновить summary/proposed_changes + статус pending
    await db.run(
      `UPDATE ai_proposals SET
         summary = COALESCE(?, summary),
         proposed_changes = COALESCE(?::jsonb, proposed_changes),
         status = 'pending', updated_at = NOW()
       WHERE id = ?`,
      summary ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
      id,
    );
  }
  res.json(await db.get('SELECT id, status, summary FROM ai_proposals WHERE id = ?', id));
}));

// POST /api/diag/ai-daily/ai-proposals/:id/message?s=SECRET
router.post('/ai-proposals/:id/message', checkSecret, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
    id, text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
