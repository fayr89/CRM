// TEMP: диагностический эндпоинт для ежедневного AI-обхода.
// Удалить сразу после использования — отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'x9k2m5r1p4';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily/full — все proposals + feedback с тредами
router.get('/full', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ORDER BY p.id DESC LIMIT 200`,
  );
  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`, p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const feedbackMessages = {};
  for (const fb of feedbacks) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`, fb.id,
    );
    feedbackMessages[fb.id] = msgs;
  }

  res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
}));

// POST /api/diag/daily/proposal — создать предложение
router.post('/proposal', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    d.feedback_id ?? null, d.title, d.summary,
    d.category ?? null, d.risk || 'medium', d.source ?? null,
    d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
  );
  const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
  res.status(201).json(row);
}));

// PATCH /api/diag/daily/proposal/:id — обновить статус/поля предложения
router.patch('/proposal/:id', asyncHandler(async (req, res) => {
  const d = req.body || {};
  if (d.decision) {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      d.decision, d.notes ?? null, req.params.id,
    );
  }
  const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
  res.json(row);
}));

// POST /api/diag/daily/proposal/:id/message — добавить сообщение в тред предложения
router.post('/proposal/:id/message', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 1, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
    req.params.id, d.text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/daily/feedback/:id — обновить статус/admin_reply обращения
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = d.status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
     resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
     WHERE id = ?`,
    newStatus, d.admin_reply ?? null, req.params.id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id));
}));

// POST /api/diag/daily/feedback/:id/message — добавить сообщение в тред обращения
router.post('/feedback/:id/message', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 1, 'AI ассистент', 'admin', ?) RETURNING id`,
    req.params.id, d.text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
