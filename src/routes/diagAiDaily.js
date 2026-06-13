// TEMP: диагностический эндпоинт для AI ежедневного обхода 2026-06-13-s25.
// Удалить отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'c7d4e2b1f8a3';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET && req.body?.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
}

router.use(checkSecret);

// GET — полный дамп: proposals по статусам + feedback с тредами
router.get('/', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending] = await Promise.all([
    db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY updated_at DESC`),
  ]);

  const allProposals = [...approved, ...revision, ...rejected, ...pending];
  for (const p of allProposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  const feedbackRows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const fb of feedbackRows) {
    fb.thread = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({ proposals: { approved, revision, rejected, pending }, feedback: feedbackRows });
}));

// PATCH /proposals/:id — обновить статус предложения
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { decision, notes } = req.body || {};
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
     admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
    decision, notes ?? null, id,
  );
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
}));

// POST /proposals — создать новое предложение
router.post('/proposals', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary,
    category ?? null, risk || 'medium', source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
}));

// POST /proposals/:id/messages — добавить сообщение в тред предложения
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
    id, user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /feedback/:id — обновить статус / ответ обращения
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, admin_reply } = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET
       status = ?,
       admin_reply = COALESCE(?, admin_reply),
       resolved_by = ?,
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    admin_reply ?? null,
    justResolved ? 0 : cur.resolved_by,
    id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
}));

// POST /feedback/:id/messages — добавить сообщение в тред обращения
router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
    id, text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
