// TEMP: diag/daily-p7n2ws endpoint для AI daily-run 2026-06-19 (удалить после использования)
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'p7n2ws';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const { action } = req.query;

  if (action === 'get_proposals') {
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${req.query.status ? 'WHERE p.status = ?' : ''}
       ORDER BY p.created_at DESC`,
      ...(req.query.status ? [req.query.status] : []),
    );
    return res.json({ data: rows });
  }

  if (action === 'get_proposal_messages') {
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

  if (action === 'patch_proposal') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { decision } = req.query;
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
  }

  if (action === 'post_proposal_message') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const text = req.query.text || '';
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'post_proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    let pcJson = null;
    if (proposed_changes) {
      try { JSON.parse(proposed_changes); pcJson = proposed_changes; } catch { /* skip */ }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title,
      summary,
      category || null,
      risk || 'medium',
      source || null,
      pcJson,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (action === 'get_feedback') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );
    return res.json({ data: rows });
  }

  if (action === 'get_feedback_messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: rows });
  }

  if (action === 'patch_feedback') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { status, admin_reply } = req.query;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status || cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?,
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      admin_reply || null,
      justResolved ? 0 : cur.resolved_by,
      id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
  }

  if (action === 'post_feedback_message') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const text = req.query.text || '';
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown action', known: [
    'get_proposals', 'get_proposal_messages', 'patch_proposal', 'post_proposal_message', 'post_proposal',
    'get_feedback', 'get_feedback_messages', 'patch_feedback', 'post_feedback_message',
  ] });
}));

export default router;
