// Временный diag-эндпоинт для AI-обхода 2026-06-14-s62.
// УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '13c53aa6d0a0';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/ai-run/proposals?status=...
router.get('/proposals', asyncHandler(async (req, res) => {
  const where = req.query.status ? 'WHERE p.status = ?' : '';
  const params = req.query.status ? [req.query.status] : [];
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT 100`,
    ...params,
  );
  res.json({ data: rows });
}));

// GET /api/diag/ai-run/proposals/:id/messages
router.get('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
    Number(req.params.id),
  );
  res.json({ data: rows });
}));

// PATCH /api/diag/ai-run/proposals/:id  { decision, notes, summary, title }
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes, summary, title } = req.body || {};
  const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(req.params.id));
  if (!cur) return res.status(404).json({ error: 'not found' });
  const sets = [];
  const vals = [];
  if (decision) { sets.push('status = ?'); vals.push(decision); }
  if (notes !== undefined) { sets.push('admin_notes = ?'); vals.push(notes); }
  if (summary !== undefined) { sets.push('summary = ?'); vals.push(summary); }
  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  sets.push('updated_at = NOW()');
  await db.run(`UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`, ...vals, Number(req.params.id));
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(req.params.id)));
}));

// POST /api/diag/ai-run/proposals  { title, summary, ... }
router.post('/proposals', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null,
    title,
    summary,
    category ?? null,
    risk ?? 'medium',
    source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
}));

// POST /api/diag/ai-run/proposals/:id/messages  { text, user_name }
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// GET /api/diag/ai-run/feedback  — all open/awaiting with threads
router.get('/feedback', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT f.*, u.name AS user_name_db, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 100`,
  );
  for (const row of rows) {
    row.thread = await db.all(
      `SELECT id, user_name, role, text, created_at FROM feedback_messages
       WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      row.id,
    );
  }
  res.json({ data: rows });
}));

// POST /api/diag/ai-run/feedback/:id/messages  { text, user_name }
router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/ai-run/feedback/:id  { status, admin_reply }
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body || {};
  const sets = ['updated_at = NOW()'];
  const vals = [];
  if (status) { sets.push('status = ?'); vals.push(status); }
  if (admin_reply !== undefined) { sets.push('admin_reply = ?'); vals.push(admin_reply); }
  await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, Number(req.params.id));
  res.json({ ok: true });
}));

export default router;
