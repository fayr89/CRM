// TEMP: ежедневный AI-обход. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'd7f3b9e2a4c8';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// --- AI Proposals ---

router.get('/proposals', asyncHandler(async (req, res) => {
  const where = req.query.status ? 'WHERE p.status = ?' : '';
  const params = req.query.status ? [String(req.query.status)] : [];
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

router.get('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT id, user_id, user_name, role, text, created_at
     FROM ai_proposal_messages
     WHERE proposal_id = ?
     ORDER BY created_at ASC, id ASC`,
    Number(req.params.id),
  );
  res.json({ data: rows });
}));

router.post('/proposals', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals
     (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    d.feedback_id ?? null,
    d.title,
    d.summary,
    d.category ?? null,
    d.risk || 'medium',
    d.source ?? null,
    d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
  );
  res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
}));

router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body || {};
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = ?,
     admin_decision_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    decision,
    notes ?? null,
    Number(req.params.id),
  );
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(req.params.id)));
}));

router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
    Number(req.params.id),
    user_name || 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// --- Feedback ---

router.get('/feedback', asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const [where, params] = status
    ? ['WHERE f.status = ?', [status]]
    : ["WHERE f.status IN ('open','awaiting_approval','in_progress')", []];
  const rows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     ${where}
     ORDER BY f.created_at DESC`,
    ...params,
  );
  for (const fb of rows) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }
  res.json({ data: rows });
}));

router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(req.params.id));
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
     resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    admin_reply ?? null,
    cur.id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
}));

router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const fb = await db.get('SELECT id FROM feedback WHERE id = ?', Number(req.params.id));
  if (!fb) return res.status(404).json({ error: 'not found' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
    fb.id,
    user_name || 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
