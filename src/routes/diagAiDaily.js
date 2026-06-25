// TEMPORARY — удалить после использования. Только для ежедневного AI-обхода.
// Секрет в query ?s=... даёт обход JWT-аутентификации (GET и мутации).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'k9p2x7m4q1f8';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /api/diag/ai-daily — всё нужное одним запросом
router.get('/', asyncHandler(async (_req, res) => {
  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END), p.created_at DESC
     LIMIT 200`,
  );
  // Треды обращений
  const fbIds = feedback.map(f => f.id);
  const fbMsgs = fbIds.length
    ? await db.all(
        `SELECT feedback_id, id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        JSON.stringify(fbIds),
      )
    : [];
  // Треды предложений
  const pIds = proposals.map(p => p.id);
  const pMsgs = pIds.length
    ? await db.all(
        `SELECT proposal_id, id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        JSON.stringify(pIds),
      )
    : [];

  res.json({ feedback, fb_messages: fbMsgs, proposals, proposal_messages: pMsgs });
}));

// PATCH /api/diag/ai-daily/feedback/:id — обновить статус/ответ
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
       resolved_by = CASE WHEN ? THEN 0 ELSE resolved_by END,
       resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
       updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    admin_reply ?? null,
    justResolved,
    justResolved,
    id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
}));

// POST /api/diag/ai-daily/feedback/:id/messages — написать в тред обращения
router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text, user_name } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    id,
    user_name || 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// POST /api/diag/ai-daily/proposals — создать ai_proposal
router.post('/proposals', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
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
  res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
}));

// PATCH /api/diag/ai-daily/proposals/:id — сменить статус (decision)
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { decision, notes } = req.body || {};
  if (!decision) return res.status(400).json({ error: 'decision required' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
     admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
    decision,
    notes ?? null,
    id,
  );
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
}));

// POST /api/diag/ai-daily/proposals/:id/messages — написать в тред предложения
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { text, user_name } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    id,
    user_name || 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
