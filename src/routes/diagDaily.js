// TEMP: daily AI run 2026-06-09. Delete after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'drun-2026-06-09-7x9z';

function auth(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET ai-proposals by status
router.get('/proposals', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const status = req.query.status || 'pending';
  const rows = await db.all(
    `SELECT id, title, summary, category, risk, source, status, feedback_id,
            proposed_changes, admin_notes, created_at, updated_at
     FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`,
    status,
  );
  res.json({ status, count: rows.length, proposals: rows });
}));

// GET proposal messages thread
router.get('/proposals/:id/messages', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const msgs = await db.all(
    `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
     WHERE proposal_id = ? ORDER BY created_at ASC`,
    Number(req.params.id),
  );
  res.json({ proposal_id: Number(req.params.id), messages: msgs });
}));

// POST create proposal
router.post('/proposals', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
    title, summary, category || 'feature', risk || 'medium', source || 'daily-run-2026-06-09',
    JSON.stringify(proposed_changes || []), feedback_id || null,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// PATCH proposal status/decision
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { decision, summary, proposed_changes } = req.body;
  const id = Number(req.params.id);
  if (decision === 'done') {
    await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id);
  } else if (decision === 'pending') {
    await db.run(
      `UPDATE ai_proposals SET status='pending', summary=COALESCE(?,summary),
       proposed_changes=COALESCE(?::jsonb,proposed_changes), updated_at=NOW() WHERE id=?`,
      summary || null, proposed_changes ? JSON.stringify(proposed_changes) : null, id,
    );
  }
  res.json({ ok: true, id, decision });
}));

// POST message to proposal thread
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { text, user_name } = req.body;
  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
     VALUES (?, ?, 'admin', ?, NOW())`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.json({ ok: true });
}));

// GET all feedback with threads (open + awaiting_approval)
router.get('/feedback', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const feedbacks = await db.all(
    `SELECT id, author_name, author_role, category, subject, body, status,
            admin_reply, created_at, updated_at
     FROM feedback ORDER BY created_at DESC LIMIT 100`,
  );
  const threads = feedbacks.length
    ? await db.all(
        `SELECT feedback_id, id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?)
         ORDER BY created_at ASC`,
        feedbacks.map((f) => f.id),
      )
    : [];
  const threadMap = {};
  for (const m of threads) {
    if (!threadMap[m.feedback_id]) threadMap[m.feedback_id] = [];
    threadMap[m.feedback_id].push(m);
  }
  res.json({
    total: feedbacks.length,
    feedbacks: feedbacks.map((f) => ({ ...f, thread: threadMap[f.id] || [] })),
  });
}));

// POST message to feedback thread
router.post('/feedback/:id/message', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { text, user_name } = req.body;
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
     VALUES (?, ?, 'admin', ?, NOW())`,
    Number(req.params.id), user_name || 'AI ассистент', text,
  );
  res.json({ ok: true });
}));

// PATCH feedback status
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { status, admin_reply } = req.body;
  await db.run(
    `UPDATE feedback SET status=COALESCE(?,status), admin_reply=COALESCE(?,admin_reply),
     updated_at=NOW() WHERE id=?`,
    status || null, admin_reply || null, Number(req.params.id),
  );
  res.json({ ok: true });
}));

export default router;
