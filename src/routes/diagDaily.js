// TEMP — ежедневный AI-обход 2026-06-20. Секрет: c8d4f1b9e7a23n5p
// Сносится в том же раунде: chore(diag): remove diagDaily.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'c8d4f1b9e7a23n5p';
const router = Router();

router.use((req, res, next) => {
  if (req.query.s !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /api/diag/daily — все данные для обхода
router.get('/', asyncHandler(async (_req, res) => {
  const proposals = {};
  for (const status of ['approved', 'revision', 'rejected', 'pending']) {
    proposals[status] = await db.all(
      `SELECT p.*, f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = ?
       ORDER BY p.created_at DESC`,
      status,
    );
  }
  const allProposalIds = Object.values(proposals).flat().map(p => p.id);
  const proposalMessages = {};
  for (const id of allProposalIds) {
    proposalMessages[id] = await db.all(
      `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC`,
      id,
    );
  }
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.updated_at DESC`,
  );
  const feedbackMessages = {};
  for (const f of feedbacks) {
    feedbackMessages[f.id] = await db.all(
      `SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC`,
      f.id,
    );
  }
  res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
}));

// POST /api/diag/daily/action — мутации
router.post('/action', asyncHandler(async (req, res) => {
  const { action, ...data } = req.body || {};
  if (action === 'fb_message') {
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, ?, 'admin', ?, NOW()) RETURNING id`,
      Number(data.feedback_id), data.user_name || 'AI ассистент', String(data.text),
    );
    await db.run(`UPDATE feedback SET updated_at = NOW() WHERE id = ?`, Number(data.feedback_id));
    res.json({ ok: true, id: r.lastInsertRowid });
  } else if (action === 'fb_update') {
    const sets = [];
    const params = [];
    if (data.status) { sets.push('status = ?'); params.push(data.status); }
    if (data.admin_reply != null) { sets.push('admin_reply = ?'); params.push(data.admin_reply); }
    sets.push('updated_at = NOW()');
    await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params, Number(data.id));
    res.json({ ok: true });
  } else if (action === 'proposal_create') {
    const r = await db.run(
      `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
      String(data.title),
      String(data.summary),
      data.category || 'feature',
      data.risk || 'medium',
      data.source || 'daily-run-2026-06-20',
      JSON.stringify(data.proposed_changes || []),
      data.feedback_id ? Number(data.feedback_id) : null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } else if (action === 'proposal_update') {
    const sets = [];
    const params = [];
    if (data.status) { sets.push('status = ?'); params.push(data.status); }
    if (data.summary != null) { sets.push('summary = ?'); params.push(data.summary); }
    if (data.title != null) { sets.push('title = ?'); params.push(data.title); }
    if (data.admin_notes != null) { sets.push('admin_notes = ?'); params.push(data.admin_notes); }
    sets.push('updated_at = NOW()');
    await db.run(`UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`, ...params, Number(data.id));
    res.json({ ok: true });
  } else if (action === 'proposal_message') {
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at)
       VALUES (?, ?, ?, NOW()) RETURNING id`,
      Number(data.proposal_id), data.user_name || 'AI ассистент', String(data.text),
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } else {
    res.status(400).json({ error: `unknown action: ${action}` });
  }
}));

export default router;
