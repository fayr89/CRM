// Временный диагностический эндпоинт для AI-обхода обращений 2026-06-12.
// СНЕСТИ сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dail-ai-j7k2x9p';

router.use((req, res, next) => {
  const s = req.query.secret ?? req.body?.secret;
  if (s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/feedback-full — открытые feedback с тредами + все ai_proposals с тредами
router.get('/feedback-full', asyncHandler(async (_req, res) => {
  const feedbacks = await db.all(
    `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
            f.created_at, f.updated_at, u.name AS user_name, u.email AS user_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 100`,
  );

  const fbThreads = {};
  for (const fb of feedbacks) {
    fbThreads[fb.id] = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY p.created_at DESC
     LIMIT 200`,
  );

  const propThreads = {};
  for (const p of proposals) {
    propThreads[p.id] = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  res.json({ feedbacks, fbThreads, proposals, propThreads });
}));

// POST /api/diag/feedback-msg — добавить сообщение в тред обращения от «AI ассистент»
router.post('/feedback-msg', asyncHandler(async (req, res) => {
  const { feedback_id, text } = req.body;
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
    feedback_id, text,
  );
  res.json({ ok: true });
}));

// PATCH /api/diag/feedback-status — сменить статус обращения
router.patch('/feedback-status', asyncHandler(async (req, res) => {
  const { feedback_id, status, admin_reply } = req.body;
  if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
  if (admin_reply != null) {
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
      status, admin_reply, feedback_id,
    );
  } else {
    await db.run(
      `UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, feedback_id,
    );
  }
  res.json({ ok: true });
}));

// POST /api/diag/ai-proposal — создать новый proposal
router.post('/ai-proposal', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary,
    category ?? null, risk ?? 'medium',
    source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/ai-proposal-status — пометить proposal нужным статусом
router.patch('/ai-proposal-status', asyncHandler(async (req, res) => {
  const { id, decision } = req.body;
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
    decision, id,
  );
  res.json({ ok: true });
}));

// POST /api/diag/ai-proposal-msg — добавить сообщение в тред proposal
router.post('/ai-proposal-msg', asyncHandler(async (req, res) => {
  const { proposal_id, text } = req.body;
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
    proposal_id, text,
  );
  res.json({ ok: true });
}));

export default router;
