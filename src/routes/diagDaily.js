// ВРЕМЕННЫЙ эндпоинт для AI daily-run. Удалить после использования.
// Секрет в пути — не добавлять в логи/мониторинг.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'k5p9rx2j';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily/feedback?s=... — все открытые/awaiting обращения с тредами
router.get('/feedback', asyncHandler(async (_req, res) => {
  const rows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','in_progress','awaiting_approval')
     ORDER BY f.created_at ASC`,
  );
  for (const f of rows) {
    f.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      f.id,
    );
  }
  res.json({ data: rows });
}));

// GET /api/diag/daily/proposals?s=&status= — предложения с тредами
router.get('/proposals', asyncHandler(async (req, res) => {
  const where = req.query.status ? `WHERE p.status = '${String(req.query.status).replace(/'/g, '')}'` : '';
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ${where}
     ORDER BY p.created_at DESC`,
  );
  for (const p of rows) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }
  res.json({ data: rows });
}));

// POST /api/diag/daily/feedback/:id/message — написать в тред обращения
router.post('/feedback/:id/message', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const fb = await db.get('SELECT id FROM feedback WHERE id = ?', req.params.id);
  if (!fb) return res.status(404).json({ error: 'not found' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
    fb.id,
    user_name || 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/daily/feedback/:id — сменить статус / добавить admin_reply
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status || cur.status;
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
    newStatus, admin_reply ?? null, cur.id,
  );
  res.json({ ok: true, id: cur.id, status: newStatus });
}));

// POST /api/diag/daily/proposals — создать ai_proposal
router.post('/proposals', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'title+summary required' });
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

// PATCH /api/diag/daily/proposals/:id — решение (done/revision/etc.) + заметка в тред
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes, message } = req.body || {};
  const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  if (decision) {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, cur.id,
    );
  }
  if (message) {
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text) VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      cur.id, message,
    );
  }
  res.json({ ok: true, id: cur.id });
}));

export default router;
