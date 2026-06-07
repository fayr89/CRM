// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного AI-обхода.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dR8xZp4Lw1Nm';

function checkSecret(req, res, next) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

router.use(checkSecret);

// GET /api/diag/daily-run/proposals?status=approved
router.get('/proposals', asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status).replace(/[^a-z_]/g, '') : null;
  const where = status ? `WHERE p.status = '${status}'` : '';
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ${where}
     ORDER BY p.created_at DESC`,
  );
  res.json({ data: rows, total: rows.length });
}));

// GET /api/diag/daily-run/proposals/:id/messages
router.get('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC`,
    Number(req.params.id),
  );
  res.json({ data: rows });
}));

// PATCH /api/diag/daily-run/proposals/:id  { decision, summary, proposed_changes }
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const fields = [];
  const vals = [];
  const newStatus = body.decision ?? body.status;
  if (newStatus !== undefined) { fields.push('status = ?'); vals.push(String(newStatus)); }
  if (body.summary !== undefined) { fields.push('summary = ?'); vals.push(String(body.summary)); }
  if (body.proposed_changes !== undefined) {
    fields.push("proposed_changes = ?::jsonb");
    vals.push(JSON.stringify(body.proposed_changes));
  }
  if (!fields.length) { res.json({ ok: true, skipped: true }); return; }
  fields.push('updated_at = NOW()');
  await db.run(`UPDATE ai_proposals SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
  const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
  res.json(row);
}));

// POST /api/diag/daily-run/proposals/:id/messages  { text }
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.text || '');
  if (!text) { res.status(400).json({ error: 'text required' }); return; }
  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
     VALUES (?, 'AI ассистент', 'ai', ?, NOW())`,
    id, text,
  );
  res.json({ ok: true });
}));

// POST /api/diag/daily-run/proposals  { title, summary, category, risk, source, feedback_id, proposed_changes }
router.post('/proposals', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending', NOW(), NOW()) RETURNING id`,
    String(b.title || ''),
    String(b.summary || ''),
    b.category || 'feature',
    b.risk || 'medium',
    b.source || 'daily-run-2026-06-07',
    b.feedback_id || null,
    JSON.stringify(b.proposed_changes || []),
  );
  const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
  res.status(201).json(row);
}));

// GET /api/diag/daily-run/feedback-full  — все open/in_progress/awaiting_approval с тредами
router.get('/feedback-full', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','in_progress','awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const row of rows) {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at FROM feedback_messages
       WHERE feedback_id = ? ORDER BY created_at ASC`,
      row.id,
    );
    row.thread = msgs;
  }
  res.json({ data: rows, total: rows.length });
}));

// PATCH /api/diag/daily-run/feedback/:id  { status, admin_reply }
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
  if (!cur) { res.status(404).json({ error: 'not found' }); return; }
  const newStatus = b.status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET
       status = ?,
       admin_reply = COALESCE(?, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    b.admin_reply ?? null,
    id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
}));

// POST /api/diag/daily-run/feedback/:id/messages  { text }
router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.text || '');
  if (!text) { res.status(400).json({ error: 'text required' }); return; }
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
    id, text,
  );
  res.json({ ok: true });
}));

export default router;
