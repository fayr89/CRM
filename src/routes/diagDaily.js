// TEMP: ежедневный обход AI — разовый diag. Снести сразу после получения данных.
// GET /api/diag/daily-run?s=<DAILY_SECRET>
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DAILY_SECRET = 'airun-2026-06-12-s15-x7q2';

router.use((req, res, next) => {
  if (req.query?.s !== DAILY_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (_req, res) => {
  // ai_proposals всех статусов кроме done
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status != 'done'
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END),
              p.created_at DESC`,
  );

  // Треды для каждого предложения
  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  // Все feedback в open / awaiting_approval
  const feedbacks = await db.all(
    `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
            f.created_at, f.updated_at, u.name AS author_name, u.email AS author_email, u.role AS author_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at ASC`,
  );

  // Треды для каждого обращения
  const feedbackMessages = {};
  for (const fb of feedbacks) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    feedbackMessages[fb.id] = msgs;
  }

  res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
}));

// POST для записи сообщений в feedback_messages
router.post('/feedback-msg', asyncHandler(async (req, res) => {
  const { feedback_id, text, user_name, role } = req.body || {};
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const r = await db.get(
    `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
     VALUES (?, ?, ?, ?)
     RETURNING id, feedback_id, user_name, role, text, created_at`,
    feedback_id,
    user_name || 'AI ассистент',
    role || 'admin',
    text,
  );
  res.json(r);
}));

// PATCH для смены статуса feedback
router.patch('/feedback-status', asyncHandler(async (req, res) => {
  const { feedback_id, status, admin_reply } = req.body || {};
  if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
  const updates = ['status = ?'];
  const params = [status];
  if (admin_reply !== undefined) {
    updates.push('admin_reply = ?');
    params.push(admin_reply);
  }
  params.push(feedback_id);
  await db.query(`UPDATE feedback SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, ...params);
  res.json({ ok: true });
}));

// POST для создания ai_proposal
router.post('/ai-proposal', asyncHandler(async (req, res) => {
  const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body || {};
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.get(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
     RETURNING id, title, status`,
    title,
    summary,
    category || null,
    risk || 'medium',
    source || null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
    feedback_id || null,
  );
  res.json(r);
}));

// PATCH для смены статуса ai_proposal
router.patch('/ai-proposal-status', asyncHandler(async (req, res) => {
  const { proposal_id, decision } = req.body || {};
  if (!proposal_id || !decision) return res.status(400).json({ error: 'proposal_id and decision required' });
  await db.query(
    `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
    decision,
    proposal_id,
  );
  res.json({ ok: true });
}));

// POST сообщение в тред ai_proposal
router.post('/ai-proposal-msg', asyncHandler(async (req, res) => {
  const { proposal_id, text, user_name } = req.body || {};
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const r = await db.get(
    `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
     VALUES (?, ?, 'admin', ?)
     RETURNING id, proposal_id, user_name, role, text, created_at`,
    proposal_id,
    user_name || 'AI ассистент',
    text,
  );
  res.json(r);
}));

export default router;
