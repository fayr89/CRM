// TEMP: AI daily-run diag endpoint 2026-06-11-d2. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-d2-2026-06-11-x8p2w5v3';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/d2/all — всё для обхода: proposals (все статусы) + messages + feedbacks
router.get('/all', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const proposals = await db.all(
    `SELECT id, title, summary, category, risk, status, feedback_id, admin_notes, proposed_changes, created_at, updated_at
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
    `SELECT f.id, f.user_id, f.category, f.message, f.status, f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 50`,
  );

  const feedbackMessages = {};
  for (const f of feedbacks) {
    const msgs = await db.all(
      `SELECT id, feedback_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at`,
      f.id,
    );
    feedbackMessages[f.id] = msgs;
  }

  const closedRecent = await db.all(
    `SELECT f.id, f.category, f.message, f.status, f.admin_reply, f.updated_at,
            u.name AS user_name
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status = 'closed' ORDER BY f.updated_at DESC LIMIT 10`,
  );

  res.json({ proposals, proposalMessages, feedbacks, feedbackMessages, closedRecent });
}));

// GET /api/diag/d2/patch-proposal — изменить статус/summary предложения
router.get('/patch-proposal', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  const decision = req.query.decision;
  if (!id || !decision) return res.status(400).json({ error: 'id, decision required' });

  const fields = ['status = ?', 'updated_at = NOW()'];
  const vals = [decision];
  if (req.query.admin_notes !== undefined) { fields.push('admin_notes = ?'); vals.push(req.query.admin_notes); }
  if (req.query.summary !== undefined) { fields.push('summary = ?'); vals.push(req.query.summary); }
  vals.push(id);

  await db.run(`UPDATE ai_proposals SET ${fields.join(', ')} WHERE id = ?`, ...vals);
  res.json({ ok: true, id, decision });
}));

// GET /api/diag/d2/new-proposal — создать новое ai_proposal
router.get('/new-proposal', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { title, summary, category, risk, source } = req.query;
  if (!title || !summary) return res.status(400).json({ error: 'title, summary required' });

  const proposedChanges = req.query.proposed_changes || '[]';
  const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;

  const r = await db.run(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending', NOW(), NOW()) RETURNING id`,
    title, summary,
    category || 'feature', risk || 'medium',
    source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
    feedbackId, proposedChanges,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// GET /api/diag/d2/proposal-msg — добавить сообщение в тред proposal
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

// GET /api/diag/d2/feedback-msg — добавить сообщение в тред обращения
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

// GET /api/diag/d2/feedback-update — обновить статус/reply обращения
router.get('/feedback-update', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const fields = ['updated_at = NOW()'];
  const vals = [];
  if (req.query.status !== undefined) { fields.push('status = ?'); vals.push(req.query.status); }
  if (req.query.admin_reply !== undefined) { fields.push('admin_reply = ?'); vals.push(req.query.admin_reply); }
  vals.push(id);

  await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals);
  res.json({ ok: true, id });
}));

export default router;
