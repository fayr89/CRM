// TEMP: AI daily-run diag endpoint 2026-06-12-s16. Remove after use.
// Secret: d5f1d6ec2508292e74a92a30
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'd5f1d6ec2508292e74a92a30';
const router = Router();

function checkSecret(req, res, next) {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}
router.use(checkSecret);

// GET /api/diag/ai-daily?secret=...&type=proposals&status=approved|revision|rejected|pending
// GET /api/diag/ai-daily?secret=...&type=proposal-messages&id=X
// GET /api/diag/ai-daily?secret=...&type=feedback-full
router.get('/', asyncHandler(async (req, res) => {
  const type = req.query.type || 'feedback-full';

  if (type === 'proposals') {
    const status = req.query.status;
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${status ? 'WHERE p.status = ?' : ''}
       ORDER BY p.created_at DESC
       LIMIT 100`,
      ...(status ? [status] : []),
    );
    return res.json({ data: rows });
  }

  if (type === 'proposal-messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: rows });
  }

  if (type === 'feedback-full') {
    const rows = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const result = [];
    for (const fb of rows) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      result.push({ ...fb, messages: msgs });
    }
    return res.json({ data: result });
  }

  return res.status(400).json({ error: 'unknown type' });
}));

// PATCH /api/diag/ai-daily?secret=...&type=proposal&id=X
// body: { decision: 'done'|'approved'|'rejected'|'revision', notes? }
// PATCH /api/diag/ai-daily?secret=...&type=feedback&id=X
// body: { status: '...', admin_reply? }
router.patch('/', asyncHandler(async (req, res) => {
  const type = req.query.type;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  if (type === 'proposal') {
    const { decision, notes } = req.body || {};
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
  }

  if (type === 'feedback') {
    const { status, admin_reply } = req.body || {};
    if (!status && admin_reply === undefined) return res.status(400).json({ error: 'nothing to update' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      newStatus, admin_reply ?? null, id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
  }

  return res.status(400).json({ error: 'unknown type' });
}));

// POST /api/diag/ai-daily?secret=...&type=proposal
// body: { title, summary, category, risk, source, feedback_id?, proposed_changes? }
// POST /api/diag/ai-daily?secret=...&type=proposal-message&id=X
// body: { text, user_name }
// POST /api/diag/ai-daily?secret=...&type=feedback-message&id=X
// body: { text, user_name }
router.post('/', asyncHandler(async (req, res) => {
  const type = req.query.type;

  if (type === 'proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
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
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(created);
  }

  if (type === 'proposal-message') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { text, user_name } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
      id, user_name ?? 'AI ассистент', text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (type === 'feedback-message') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { text, user_name } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
      id, user_name ?? 'AI ассистент', text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown type' });
}));

export default router;
