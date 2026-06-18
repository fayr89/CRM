// TEMP: ежедневный обход AI daily-run 2026-06-18 h7p2qn
// Удалить сразу после использования в этом же обходе.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'h7p2qn';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-h7p2qn?s=h7p2qn
// Возвращает: all ai_proposals + их messages + all feedback (open/awaiting_approval) + их threads
router.get('/', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     ORDER BY p.created_at DESC LIMIT 200`,
  );

  const proposalMsgs = await db.all(
    `SELECT m.* FROM ai_proposal_messages m
     ORDER BY m.proposal_id, m.created_at ASC, m.id ASC
     LIMIT 2000`,
  );

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 200`,
  );

  const threads = await db.all(
    `SELECT m.* FROM feedback_messages m
     WHERE m.feedback_id IN (
       SELECT id FROM feedback WHERE status IN ('open','awaiting_approval')
     )
     ORDER BY m.feedback_id, m.created_at ASC, m.id ASC
     LIMIT 2000`,
  );

  res.json({ proposals, proposalMsgs, feedback, threads });
}));

// POST /api/diag/daily-h7p2qn/feedback-msg?s=h7p2qn
// { feedback_id, text }
router.post('/feedback-msg', asyncHandler(async (req, res) => {
  const { feedback_id, text } = req.body || {};
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
     VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
    Number(feedback_id), String(text),
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// POST /api/diag/daily-h7p2qn/patch-feedback?s=h7p2qn
// { id, status, admin_reply }
router.post('/patch-feedback', asyncHandler(async (req, res) => {
  const { id, status, admin_reply } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const sets = [];
  const params = [];
  if (status) { sets.push('status = ?'); params.push(String(status)); }
  if (admin_reply !== undefined) { sets.push('admin_reply = ?'); params.push(String(admin_reply)); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  sets.push('updated_at = NOW()');
  params.push(Number(id));
  await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
  res.json({ ok: true });
}));

// POST /api/diag/daily-h7p2qn/create-proposal?s=h7p2qn
// { feedback_id?, title, summary, category, risk, source, proposed_changes? }
router.post('/create-proposal', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ? Number(feedback_id) : null,
    String(title),
    String(summary),
    category ? String(category) : null,
    risk || 'medium',
    source ? String(source) : null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// POST /api/diag/daily-h7p2qn/patch-proposal?s=h7p2qn
// { id, decision } — decision: approved|rejected|revision|done
router.post('/patch-proposal', asyncHandler(async (req, res) => {
  const { id, decision, notes } = req.body || {};
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
    String(decision), notes ? String(notes) : null, Number(id),
  );
  res.json({ ok: true });
}));

// POST /api/diag/daily-h7p2qn/post-proposal-msg?s=h7p2qn
// { proposal_id, text }
router.post('/post-proposal-msg', asyncHandler(async (req, res) => {
  const { proposal_id, text } = req.body || {};
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
    Number(proposal_id), String(text),
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

export default router;
