// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода. Удалить после использования.
// GET  /api/diag/daily-run?secret=XXX&action=all        — всё сразу (feedback+proposals)
// POST /api/diag/daily-run?secret=XXX&action=feedback-patch   body: {id, status, admin_reply}
// POST /api/diag/daily-run?secret=XXX&action=feedback-message body: {feedback_id, text}
// POST /api/diag/daily-run?secret=XXX&action=proposal-create  body: {...proposal fields...}
// POST /api/diag/daily-run?secret=XXX&action=proposal-patch   body: {id, decision, notes}
// POST /api/diag/daily-run?secret=XXX&action=proposal-message body: {proposal_id, text}
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr_s42_9f2k7x';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const action = req.query.action || 'all';
  if (action !== 'all') return res.status(400).json({ error: 'unknown action' });

  const feedbacks = await db.all(`
    SELECT f.id, f.status, f.category, f.subject, f.message, f.created_at, f.updated_at,
           f.admin_reply, f.user_id,
           u.name AS user_name, u.email AS user_email, u.role AS user_role
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE f.status IN ('open','awaiting_approval')
    ORDER BY f.created_at DESC
    LIMIT 100
  `);

  const fbIds = feedbacks.map(f => f.id);
  let fbMessages = [];
  if (fbIds.length) {
    fbMessages = await db.all(`
      SELECT id, feedback_id, user_name, role, text, created_at
      FROM feedback_messages
      WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[])
      ORDER BY feedback_id, created_at ASC, id ASC
    `);
  }
  const fbMsgMap = {};
  for (const m of fbMessages) {
    if (!fbMsgMap[m.feedback_id]) fbMsgMap[m.feedback_id] = [];
    fbMsgMap[m.feedback_id].push(m);
  }
  const feedbacksWithThreads = feedbacks.map(f => ({ ...f, thread: fbMsgMap[f.id] || [] }));

  const proposals = await db.all(`
    SELECT p.*, u.name AS admin_decision_by_name,
           f.subject AS feedback_subject
    FROM ai_proposals p
    LEFT JOIN users u ON u.id = p.admin_decision_by
    LEFT JOIN feedback f ON f.id = p.feedback_id
    ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
              WHEN 'pending' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
             p.created_at DESC
    LIMIT 200
  `);

  const propIds = proposals.map(p => p.id);
  let propMessages = [];
  if (propIds.length) {
    propMessages = await db.all(`
      SELECT id, proposal_id, user_name, role, text, created_at
      FROM ai_proposal_messages
      WHERE proposal_id = ANY(ARRAY[${propIds.join(',')}]::int[])
      ORDER BY proposal_id, created_at ASC, id ASC
    `);
  }
  const propMsgMap = {};
  for (const m of propMessages) {
    if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
    propMsgMap[m.proposal_id].push(m);
  }
  const proposalsWithThreads = proposals.map(p => ({ ...p, thread: propMsgMap[p.id] || [] }));

  res.json({ feedbacks: feedbacksWithThreads, proposals: proposalsWithThreads });
}));

router.post('/', asyncHandler(async (req, res) => {
  const action = req.query.action;
  const body = req.body || {};

  if (action === 'feedback-patch') {
    const { id, status, admin_reply } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE feedback SET status = COALESCE(?, status),
       admin_reply = COALESCE(?, admin_reply), updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null, id,
    );
    return res.json({ ok: true });
  }

  if (action === 'feedback-message') {
    const { feedback_id, text } = body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
       VALUES (?, 'AI ассистент', 'admin', ?)`,
      feedback_id, text,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal-create') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'proposal-patch') {
    const { id, decision, notes } = body;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW()
       WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal-message') {
    const { proposal_id, text } = body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
       VALUES (?, 'AI ассистент', 'admin', ?)`,
      proposal_id, text,
    );
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
