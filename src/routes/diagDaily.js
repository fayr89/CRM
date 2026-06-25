// TEMP diag endpoint for AI daily run 2026-06-25-v10 — remove after use
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'dr10-2026-06-25-vX9kLm3zQ7';
const router = Router();

function checkSecret(req, res, next) {
  if (req.query.secret !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

// Full data dump: all feedback (open/awaiting_approval/in_progress) with threads + all ai_proposals with messages
router.get('/data', checkSecret, asyncHandler(async (_req, res) => {
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const fbIds = feedbacks.map(f => f.id);
  let threads = [];
  if (fbIds.length) {
    threads = await db.all(
      `SELECT feedback_id, id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ANY(?::int[])
       ORDER BY feedback_id, created_at ASC, id ASC`,
      `{${fbIds.join(',')}}`,
    );
  }
  const threadMap = {};
  for (const m of threads) {
    if (!threadMap[m.feedback_id]) threadMap[m.feedback_id] = [];
    threadMap[m.feedback_id].push(m);
  }
  const feedbackWithThreads = feedbacks.map(f => ({ ...f, thread: threadMap[f.id] || [] }));

  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject
     FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
               WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
              p.created_at DESC LIMIT 200`,
  );
  const propIds = proposals.map(p => p.id);
  let propMessages = [];
  if (propIds.length) {
    propMessages = await db.all(
      `SELECT proposal_id, id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[])
       ORDER BY proposal_id, created_at ASC, id ASC`,
      `{${propIds.join(',')}}`,
    );
  }
  const propMsgMap = {};
  for (const m of propMessages) {
    if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
    propMsgMap[m.proposal_id].push(m);
  }
  const proposalsWithMessages = proposals.map(p => ({ ...p, messages: propMsgMap[p.id] || [] }));

  res.json({ feedbacks: feedbackWithThreads, proposals: proposalsWithMessages });
}));

// GET-based action endpoint — all write ops via query params (web_fetch_vercel_url is GET-only)
router.get('/action', checkSecret, asyncHandler(async (req, res) => {
  const { op } = req.query;
  const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);

  if (op === 'patch_feedback') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const { status, admin_reply } = req.query;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const newStatus = status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_by = COALESCE(${justResolved ? '?' : 'resolved_by'}, resolved_by),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = ?`,
      ...(justResolved
        ? [newStatus, admin_reply ?? null, adminUser?.id || null, id]
        : [newStatus, admin_reply ?? null, id]),
    );
    return res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id));
  }

  if (op === 'post_fb_message') {
    const feedback_id = Number(req.query.feedback_id);
    const { text } = req.query;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, adminUser?.id || null, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'patch_proposal') {
    const id = Number(req.query.id);
    const { decision, notes } = req.query;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, adminUser?.id || null, id,
    );
    return res.json(await db.get('SELECT id, status, admin_notes FROM ai_proposals WHERE id = ?', id));
  }

  if (op === 'create_proposal') {
    const { title, summary, category, risk, source } = req.query;
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    let proposed_changes = null;
    if (req.query.proposed_changes) {
      try { proposed_changes = JSON.parse(req.query.proposed_changes); } catch { /* ignore */ }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id, title, summary, category ?? null, risk ?? 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'post_prop_message') {
    const proposal_id = Number(req.query.proposal_id);
    const { text } = req.query;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
      proposal_id, adminUser?.id || null, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  res.status(400).json({ error: `unknown op: ${op}` });
}));

export default router;
