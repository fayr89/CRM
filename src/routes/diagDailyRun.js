// TEMPORARY diag endpoint for AI daily review run — REMOVE AFTER USE
// Protected by a one-time secret in query string.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr-2026-06-26-xK9mQpLv';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

router.use(checkSecret);

// GET — all data needed for daily run
router.get('/', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
              p.created_at DESC
     LIMIT 200`,
  );

  const proposalIds = proposals.map(p => p.id);
  let proposalMessages = [];
  if (proposalIds.length > 0) {
    proposalMessages = await db.all(
      `SELECT id, proposal_id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages
       WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
       ORDER BY created_at ASC, id ASC`,
    );
  }

  const feedbackRows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
            r.name AS resolved_by_name
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN users r ON r.id = f.resolved_by
     WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
              f.created_at DESC
     LIMIT 200`,
  );

  const feedbackIds = feedbackRows.map(f => f.id);
  let feedbackMessages = [];
  if (feedbackIds.length > 0) {
    feedbackMessages = await db.all(
      `SELECT id, feedback_id, user_id, user_name, role, text, created_at
       FROM feedback_messages
       WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
       ORDER BY created_at ASC, id ASC`,
    );
  }

  const proposalMsgMap = {};
  for (const m of proposalMessages) {
    if (!proposalMsgMap[m.proposal_id]) proposalMsgMap[m.proposal_id] = [];
    proposalMsgMap[m.proposal_id].push(m);
  }
  const feedbackMsgMap = {};
  for (const m of feedbackMessages) {
    if (!feedbackMsgMap[m.feedback_id]) feedbackMsgMap[m.feedback_id] = [];
    feedbackMsgMap[m.feedback_id].push(m);
  }

  res.json({
    proposals: proposals.map(p => ({ ...p, messages: proposalMsgMap[p.id] || [] })),
    feedback: feedbackRows.map(f => ({ ...f, messages: feedbackMsgMap[f.id] || [] })),
  });
}));

// POST — write actions
router.post('/', asyncHandler(async (req, res) => {
  const { action, ...body } = req.body || {};

  if (action === 'create_proposal') {
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      body.feedback_id ?? null,
      body.title,
      body.summary,
      body.category ?? null,
      body.risk || 'medium',
      body.source ?? null,
      body.proposed_changes ? JSON.stringify(body.proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(created);
  }

  if (action === 'update_proposal') {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW()
       WHERE id = ?`,
      body.decision,
      body.notes ?? null,
      body.id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', body.id));
  }

  if (action === 'post_proposal_message') {
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      body.proposal_id,
      body.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (action === 'update_feedback') {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', body.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = body.status ?? cur.status;
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      body.admin_reply ?? null,
      body.id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', body.id));
  }

  if (action === 'post_feedback_message') {
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      body.feedback_id,
      body.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  res.status(400).json({ error: 'unknown action' });
}));

export default router;
