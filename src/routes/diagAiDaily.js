// TEMP: daily-run diag endpoint 2026-06-12-s18. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr-2026-06-12-s18-z9m7k';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET ?action=get_proposals[&status=approved|revision|rejected|pending]
// GET ?action=get_feedback
// GET ?action=get_proposal_messages&id=N
router.get('/', asyncHandler(async (req, res) => {
  const { action, status, id } = req.query;

  if (action === 'get_proposals') {
    const where = status ? 'WHERE p.status = ?' : '';
    const params = status ? [status] : [];
    const rows = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${where}
       ORDER BY p.created_at DESC`,
      ...params,
    );
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    return res.json({ data: rows });
  }

  if (action === 'get_feedback') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
    );
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    return res.json({ data: rows });
  }

  if (action === 'get_proposal_messages' && id) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      Number(id),
    );
    return res.json({ data: msgs });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

// POST body: { action, ...params }
router.post('/', asyncHandler(async (req, res) => {
  const { action } = req.body || {};

  if (action === 'post_feedback_msg') {
    const { feedback_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      Number(feedback_id), text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (action === 'patch_feedback') {
    const { feedback_id, status, admin_reply } = req.body;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(feedback_id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = CASE WHEN ${justResolved ? 'TRUE' : 'FALSE'} THEN 0 ELSE resolved_by END,
         resolved_at = CASE WHEN ${justResolved ? 'TRUE' : 'FALSE'} THEN NOW() ELSE resolved_at END,
         updated_at = NOW()
       WHERE id = ?`,
      newStatus, admin_reply ?? null, cur.id,
    );
    return res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', cur.id));
  }

  if (action === 'create_proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (action === 'patch_proposal') {
    const { proposal_id, decision, notes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?,
       admin_decision_by = 0, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, notes ?? null, Number(proposal_id),
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(proposal_id)));
  }

  if (action === 'post_proposal_msg') {
    const { proposal_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      Number(proposal_id), text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
