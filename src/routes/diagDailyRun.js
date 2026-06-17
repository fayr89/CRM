// TEMP: диагностический эндпоинт для ежедневного обхода AI (daily-run-2026-06-17-v54).
// Удалить после использования!
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr_ctbabg_v54_9xKp2';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /data — proposals (approved/revision/rejected/pending) + feedback (open/awaiting_approval) с тредами
router.get('/data', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     WHERE p.status IN ('approved','revision','rejected','pending')
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
  );
  const proposalIds = proposals.map((p) => p.id);
  const proposalMessages = proposalIds.length
    ? await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(?)
         ORDER BY created_at ASC, id ASC`,
        proposalIds,
      )
    : [];

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );
  const feedbackIds = feedback.map((f) => f.id);
  const feedbackMessages = feedbackIds.length
    ? await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?)
         ORDER BY created_at ASC, id ASC`,
        feedbackIds,
      )
    : [];

  res.json({ proposals, proposalMessages, feedback, feedbackMessages });
}));

// POST /feedback-message — вставить сообщение от «AI ассистент» в тред обращения
router.post('/feedback-message', asyncHandler(async (req, res) => {
  const { feedback_id, text } = req.body || {};
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
    feedback_id,
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /feedback-status — сменить статус обращения (+ опциональный admin_reply)
router.patch('/feedback-status', asyncHandler(async (req, res) => {
  const { feedback_id, status, admin_reply } = req.body || {};
  if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const justResolved = (status === 'awaiting_approval' || status === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
     resolved_by = CASE WHEN ? THEN 0 ELSE resolved_by END,
     resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
     updated_at = NOW() WHERE id = ?`,
    status,
    admin_reply ?? null,
    justResolved,
    justResolved,
    feedback_id,
  );
  res.json({ ok: true });
}));

// POST /proposal — создать ai_proposal (от AI)
router.post('/proposal', asyncHandler(async (req, res) => {
  const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null,
    title,
    summary,
    category ?? null,
    risk || 'medium',
    source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /proposal/:id — обновить статус proposal (decision + опциональные notes)
router.patch('/proposal/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
     admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
    decision,
    notes ?? null,
    req.params.id,
  );
  res.json({ ok: true });
}));

// POST /proposal-message — вставить сообщение в тред ai_proposal от «AI ассистент»
router.post('/proposal-message', asyncHandler(async (req, res) => {
  const { proposal_id, text } = req.body || {};
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
    proposal_id,
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
