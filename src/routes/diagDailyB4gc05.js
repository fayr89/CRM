// TEMP — удалить после использования (AI daily-run 2026-06-18 b4gc05)
// Диагностический роут для ежедневного AI-обхода обращений.
// Требует secret=b4gc05xpq в query для всех запросов.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'b4gc05xpq';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 1, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /proposals?status=approved|revision|rejected|pending
router.get('/proposals', asyncHandler(async (req, res) => {
  const status = req.query.status || null;
  const params = [];
  let where = '';
  if (status) { where = 'WHERE p.status = ?'; params.push(status); }
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ${where}
     ORDER BY p.created_at DESC`,
    ...params,
  );
  res.json({ data: rows });
}));

// GET /proposal-messages/:id
router.get('/proposal-messages/:id', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT id, user_id, user_name, role, text, created_at
     FROM ai_proposal_messages WHERE proposal_id = ?
     ORDER BY created_at ASC, id ASC`,
    Number(req.params.id),
  );
  res.json({ data: rows });
}));

// POST /proposals — создать proposal
router.post('/proposals', asyncHandler(async (req, res) => {
  const d = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    d.feedback_id ?? null, d.title, d.summary, d.category ?? null,
    d.risk || 'medium', d.source ?? null,
    d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /proposals/:id — decision
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body;
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
    decision, notes ?? null, Number(req.params.id),
  );
  res.json({ ok: true });
}));

// POST /proposal-messages/:id — добавить сообщение в тред proposal
router.post('/proposal-messages/:id', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 1, ?, 'admin', ?) RETURNING id`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// GET /feedback-full — все open/awaiting_approval обращения с тредами
router.get('/feedback-full', asyncHandler(async (req, res) => {
  const feedbacks = await db.all(
    `SELECT f.id, f.subject, f.category, f.status, f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.updated_at DESC`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }
  res.json({ data: feedbacks });
}));

// POST /feedback-messages/:id — добавить сообщение в тред обращения
router.post('/feedback-messages/:id', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body;
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 1, ?, 'admin', ?)`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.json({ ok: true });
}));

// PATCH /feedback/:id — обновить статус/admin_reply
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body;
  await db.run(
    `UPDATE feedback SET status = COALESCE(?, status), admin_reply = COALESCE(?, admin_reply),
     updated_at = NOW() WHERE id = ?`,
    status ?? null, admin_reply ?? null, Number(req.params.id),
  );
  res.json({ ok: true });
}));

export default router;
