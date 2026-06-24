// ВРЕМЕННЫЙ эндпоинт для ежедневного обхода AI-ассистента.
// УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ.
// GET/POST/PATCH /api/diag/ai-daily?s=<SECRET>
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'd7f2a9c4e831b56f';

function checkSecret(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
}

router.use(checkSecret);

// Всё сразу: feedback (open/awaiting_approval) с тредами + ai_proposals с тредами
router.get('/all', asyncHandler(async (_req, res) => {
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
     ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
               WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
              p.created_at DESC LIMIT 100`,
  );
  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  res.json({ feedbacks, proposals });
}));

// Написать сообщение в тред обращения
router.post('/feedback-msg', asyncHandler(async (req, res) => {
  const { feedback_id, text, user_name } = req.body || {};
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    Number(feedback_id), user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// Обновить статус / admin_reply обращения
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body || {};
  const id = Number(req.params.id);
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
     resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
     WHERE id = ?`,
    newStatus, admin_reply ?? null, id,
  );
  res.json({ ok: true, id, status: newStatus });
}));

// Создать ai_proposal
router.post('/ai-proposal', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary, category ?? null,
    risk || 'medium', source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// Обновить статус ai_proposal
router.patch('/ai-proposal/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body || {};
  const id = Number(req.params.id);
  if (!decision) return res.status(400).json({ error: 'decision required' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
     admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
    decision, notes ?? null, id,
  );
  res.json({ ok: true, id, status: decision });
}));

// Написать в тред ai_proposal
router.post('/ai-proposal-msg', asyncHandler(async (req, res) => {
  const { proposal_id, text, user_name } = req.body || {};
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    Number(proposal_id), user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
