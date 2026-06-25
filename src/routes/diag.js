// TEMPORARY — AI daily-run diag endpoint. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'diag-2026-06-25-temp';

function ok(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

// GET /api/diag/full?secret=... — proposals (all active statuses) + open/awaiting feedback with threads
router.get('/full', asyncHandler(async (req, res) => {
  if (!ok(req, res)) return;

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
     WHERE p.status IN ('approved','revision','rejected','pending')
     ORDER BY p.created_at DESC`,
  );
  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
       WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`, p.id,
    );
  }

  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages
       WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`, fb.id,
    );
  }

  res.json({ proposals, feedbacks });
}));

// POST /api/diag/act?secret=... — mutations for daily run
// { action, ...params }
router.post('/act', asyncHandler(async (req, res) => {
  if (!ok(req, res)) return;
  const { action, ...p } = req.body || {};

  if (action === 'proposal_patch') {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      p.status, p.notes ?? null, p.id,
    );
  } else if (action === 'proposal_create') {
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      p.feedback_id ?? null, p.title, p.summary,
      p.category ?? null, p.risk ?? 'medium', p.source ?? null,
      p.proposed_changes ? JSON.stringify(p.proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  } else if (action === 'proposal_message') {
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
       VALUES (?, 'AI ассистент', 'admin', ?)`, p.proposal_id, p.text,
    );
  } else if (action === 'feedback_patch') {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', p.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const newStatus = p.status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = ?`,
      newStatus, p.admin_reply ?? null, p.id,
    );
  } else if (action === 'feedback_message') {
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
       VALUES (?, 'AI ассистент', 'admin', ?)`, p.feedback_id, p.text,
    );
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  res.json({ ok: true });
}));

export default router;
