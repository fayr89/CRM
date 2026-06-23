// ВРЕМЕННЫЙ эндпоинт для AI-ежедневного обхода. Удалить после использования.
// GET /api/diag/ai-daily?s=SECRET&op=...
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'ai-daily-2026-06-23-v9r5q1';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const { op } = req.query;

  if (op === 'proposals') {
    const { status } = req.query;
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
              f.user_id AS feedback_user_id, fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${status ? 'WHERE p.status = ?' : ''}
       ORDER BY p.created_at DESC LIMIT 100`,
      ...(status ? [status] : []),
    );
    return res.json({ data: rows });
  }

  if (op === 'proposal-messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: rows });
  }

  if (op === 'feedback-full') {
    const rows = await db.all(
      `SELECT f.id, f.subject, f.message, f.category, f.status, f.created_at, f.updated_at,
              f.admin_reply, f.user_id,
              u.name AS user_name, u.email AS user_email, u.role AS user_role,
              (SELECT COUNT(*)::int FROM feedback_messages fm WHERE fm.feedback_id = f.id) AS msg_count,
              (SELECT json_agg(m ORDER BY m.created_at ASC, m.id ASC)
               FROM (SELECT id, user_id, user_name, role, text, created_at
                     FROM feedback_messages WHERE feedback_id = f.id
                     ORDER BY created_at ASC, id ASC) m) AS messages
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 50`,
    );
    return res.json({ data: rows });
  }

  if (op === 'patch-proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    const notes = req.query.notes || null;
    await db.run(
      `UPDATE ai_proposals SET status = ?,
       admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, notes, id,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
    return res.json(row);
  }

  if (op === 'post-proposal') {
    const { title, summary, category, risk, source } = req.query;
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const proposed_changes = req.query.proposed_changes || null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id,
      title,
      summary,
      category || 'feature',
      risk || 'medium',
      source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
      proposed_changes,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(row);
  }

  if (op === 'post-proposal-msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'post-feedback-msg') {
    const feedback_id = Number(req.query.feedback_id);
    const text = req.query.text;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'patch-feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    const admin_reply = req.query.admin_reply || null;
    await db.run(
      `UPDATE feedback SET status = ?,
       admin_reply = COALESCE(?, admin_reply),
       updated_at = NOW() WHERE id = ?`,
      status, admin_reply, id,
    );
    const row = await db.get('SELECT id, subject, status, admin_reply FROM feedback WHERE id = ?', id);
    return res.json(row);
  }

  return res.status(400).json({ error: 'unknown op' });
}));

export default router;
