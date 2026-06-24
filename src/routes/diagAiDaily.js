// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода.
// Защищён одноразовым секретом в query. УДАЛИТЬ после обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'f3a8d2c1e94b';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

router.use(checkSecret);

// GET ?op=proposals&status=approved|revision|rejected|pending
router.get('/', asyncHandler(async (req, res) => {
  const { op, status } = req.query;

  if (op === 'proposals') {
    const where = status ? 'WHERE p.status = $1' : '';
    const params = status ? [status] : [];
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 100`,
      ...params,
    );
    return res.json({ data: rows });
  }

  if (op === 'proposal-messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: rows });
  }

  if (op === 'feedback-full') {
    const statuses = ['open', 'awaiting_approval'];
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status = ANY($1::text[])
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC
       LIMIT 100`,
      statuses,
    );
    // load threads
    for (const fb of rows) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      fb.messages = msgs;
    }
    return res.json({ data: rows });
  }

  return res.status(400).json({ error: 'unknown op' });
}));

// POST — write operations
router.post('/', asyncHandler(async (req, res) => {
  const { op } = req.body || {};

  if (op === 'post-feedback-message') {
    const { feedback_id, text, user_name } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
      feedback_id, user_name || 'AI ассистент', text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'patch-feedback') {
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id) return res.status(400).json({ error: 'feedback_id required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus, admin_reply ?? null, feedback_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'create-proposal') {
    const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'patch-proposal') {
    const { id, decision, notes } = req.body;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json({ ok: true });
  }

  if (op === 'post-proposal-message') {
    const { proposal_id, text, user_name } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
      proposal_id, user_name || 'AI ассистент', text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown op' });
}));

export default router;
