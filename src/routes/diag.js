import { Router } from 'express';
import { asyncHandler, Forbidden } from '../errors.js';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-daily-2026-06-11-v2-Qm7p';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return next(Forbidden('bad secret'));
  next();
}

// GET /api/diag/dump?secret=... — all proposals + open feedback with threads
router.get('/dump', checkSecret, asyncHandler(async (_req, res) => {
  const proposals = await db.all(`
    SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
           p.proposed_changes, p.status, p.admin_notes, p.feedback_id,
           p.created_at, p.updated_at,
           f.subject AS feedback_subject
    FROM ai_proposals p
    LEFT JOIN feedback f ON f.id = p.feedback_id
    ORDER BY p.created_at DESC
  `);

  const proposalsWithThreads = await Promise.all(proposals.map(async (p) => {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC`,
      p.id
    );
    return { ...p, messages: msgs };
  }));

  const feedback = await db.all(`
    SELECT f.id, f.subject, f.message, f.category, f.status,
           f.admin_reply, f.created_at, f.updated_at,
           u.name AS user_name, u.email AS user_email
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
    ORDER BY f.created_at DESC
  `);

  const feedbackWithThreads = await Promise.all(feedback.map(async (fb) => {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC`,
      fb.id
    );
    return { ...fb, messages: msgs };
  }));

  res.json({ proposals: proposalsWithThreads, feedback: feedbackWithThreads });
}));

// GET /api/diag/act?secret=...&op=...&...
router.get('/act', checkSecret, asyncHandler(async (req, res) => {
  const { op, id, msg, json } = req.query;

  if (op === 'mark_proposal_done') {
    await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id);
    return res.json({ ok: true, op, id });
  }

  if (op === 'post_feedback_msg') {
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?,?,?,?)`,
      id, 'AI ассистент', 'admin', msg
    );
    return res.json({ ok: true, op, id });
  }

  if (op === 'set_feedback_awaiting') {
    await db.run(`UPDATE feedback SET status='awaiting_approval', admin_reply=?, updated_at=NOW() WHERE id=?`, msg, id);
    return res.json({ ok: true, op, id });
  }

  if (op === 'close_feedback') {
    await db.run(`UPDATE feedback SET status='closed', admin_reply=?, updated_at=NOW() WHERE id=?`, msg, id);
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?,?,?,?)`,
      id, 'AI ассистент', 'admin', msg
    );
    return res.json({ ok: true, op, id });
  }

  if (op === 'post_proposal_msg') {
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?,?,?,?)`,
      id, 'AI ассистент', 'admin', msg
    );
    return res.json({ ok: true, op, id });
  }

  if (op === 'create_proposal') {
    const data = JSON.parse(Buffer.from(json, 'base64').toString('utf8'));
    const row = await db.run(
      `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status)
       VALUES (?,?,?,?,?,?,?::jsonb,'pending') RETURNING id`,
      data.title, data.summary, data.category || 'feature', data.risk || 'medium',
      data.source || 'daily-run-2026-06-11-v2', JSON.stringify(data.proposed_changes || []),
      data.feedback_id || null
    );
    return res.json({ ok: true, op, row });
  }

  if (op === 'update_proposal_pending') {
    const data = JSON.parse(Buffer.from(json, 'base64').toString('utf8'));
    await db.run(
      `UPDATE ai_proposals SET title=?, summary=?, category=?, risk=?, proposed_changes=?::jsonb, status='pending', updated_at=NOW() WHERE id=?`,
      data.title, data.summary, data.category, data.risk,
      JSON.stringify(data.proposed_changes || []), id
    );
    return res.json({ ok: true, op, id });
  }

  res.status(400).json({ error: 'Unknown op', op });
}));

export default router;
