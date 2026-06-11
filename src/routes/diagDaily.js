// TEMP: AI daily-run diag endpoint 2026-06-11. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-2026-06-11-t7r9k2p4';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/daily/all — всё что нужно для обхода
router.get('/all', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const proposals = await db.all(
    `SELECT id, title, summary, category, risk, status, feedback_id, admin_notes, created_at, updated_at
     FROM ai_proposals ORDER BY created_at DESC LIMIT 100`,
  );

  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, proposal_id, user_name, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  const feedbacks = await db.all(
    `SELECT f.id, f.user_id, u.name AS user_name, u.email AS user_email,
            f.category, f.subject, f.message, f.status, f.admin_reply, f.created_at, f.updated_at
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval') ORDER BY f.created_at DESC LIMIT 50`,
  );

  const feedbackMessages = {};
  for (const f of feedbacks) {
    const msgs = await db.all(
      `SELECT id, feedback_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at`,
      f.id,
    );
    feedbackMessages[f.id] = msgs;
  }

  // Также тянем недавно закрытые (для полноты картины)
  const closedFeedbacks = await db.all(
    `SELECT f.id, f.user_id, u.name AS user_name, f.category, f.subject, f.message, f.status, f.admin_reply, f.created_at, f.updated_at
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status = 'closed' ORDER BY f.updated_at DESC LIMIT 10`,
  );

  res.json({
    proposals,
    proposalMessages,
    feedbacks,
    feedbackMessages,
    closedFeedbacks,
  });
}));

// GET /api/diag/daily/patch-proposal — изменить статус предложения
// Params: id, decision (done/rejected/revision/pending/approved), admin_notes?
router.get('/patch-proposal', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  const decision = req.query.decision;
  if (!id || !decision) return res.status(400).json({ error: 'id, decision required' });

  const fields = ['status = ?', 'updated_at = NOW()'];
  const vals = [decision];
  if (req.query.admin_notes) { fields.push('admin_notes = ?'); vals.push(req.query.admin_notes); }
  if (req.query.summary) { fields.push('summary = ?'); vals.push(req.query.summary); }
  vals.push(id);

  await db.run(`UPDATE ai_proposals SET ${fields.join(', ')} WHERE id = ?`, ...vals);
  res.json({ ok: true, id, decision });
}));

// GET /api/diag/daily/new-proposal — создать новое ai_proposal
// Params: title, summary, category, risk, source, feedback_id?, proposed_changes?
router.get('/new-proposal', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { title, summary, category, risk, source } = req.query;
  if (!title || !summary) return res.status(400).json({ error: 'title, summary required' });

  const proposedChanges = req.query.proposed_changes || '[]';
  const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;

  const r = await db.run(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending', NOW(), NOW()) RETURNING id`,
    title, summary, category || 'feature', risk || 'medium',
    source || `daily-run-${new Date().toISOString().slice(0,10)}`,
    feedbackId, proposedChanges,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// GET /api/diag/daily/proposal-msg — добавить сообщение в тред proposal
// Params: id, text
router.get('/proposal-msg', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  const text = req.query.text;
  if (!id || !text) return res.status(400).json({ error: 'id, text required' });

  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at) VALUES (?, 'AI ассистент', ?, NOW())`,
    id, text,
  );
  res.json({ ok: true });
}));

// GET /api/diag/daily/feedback-msg — добавить сообщение в тред обращения
// Params: id, text
router.get('/feedback-msg', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  const text = req.query.text;
  if (!id || !text) return res.status(400).json({ error: 'id, text required' });

  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at) VALUES (?, 'AI ассистент', 'admin', ?, NOW())`,
    id, text,
  );
  res.json({ ok: true });
}));

// GET /api/diag/daily/feedback-update — обновить статус/reply обращения
// Params: id, status?, admin_reply?
router.get('/feedback-update', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const fields = ['updated_at = NOW()'];
  const vals = [];
  if (req.query.status) { fields.push('status = ?'); vals.push(req.query.status); }
  if (req.query.admin_reply !== undefined) { fields.push('admin_reply = ?'); vals.push(req.query.admin_reply); }
  vals.push(id);

  await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals);
  res.json({ ok: true, id });
}));

export default router;
