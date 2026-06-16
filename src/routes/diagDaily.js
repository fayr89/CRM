// Временный диагностический эндпоинт для ежедневного AI-обхода.
// УДАЛИТЬ сразу после использования отдельным коммитом.
// Секрет: cdcadd23fa3b7e93
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'cdcadd23fa3b7e93';

function checkSecret(req, res, next) {
  if (req.query?.secret !== SECRET && req.body?.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// GET /api/diag/daily?secret=... — дамп: proposals + feedback с тредами
router.get('/', checkSecret, asyncHandler(async (_req, res) => {
  // ai_proposals — все статусы кроме done
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
              WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
              p.created_at DESC`,
  );

  // Треды предложений
  const proposalMessages = {};
  for (const p of proposals) {
    proposalMessages[p.id] = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  // feedback — open и awaiting_approval с тредами
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
     ORDER BY f.updated_at DESC
     LIMIT 100`,
  );

  const feedbackThreads = {};
  for (const fb of feedbacks) {
    feedbackThreads[fb.id] = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({
    proposals,
    proposalMessages,
    feedbacks,
    feedbackThreads,
    ts: new Date().toISOString(),
  });
}));

// POST /api/diag/daily/action?secret=...
// body: { action, ...params }
router.post('/action', checkSecret, asyncHandler(async (req, res) => {
  const { action, ...params } = req.body || {};

  if (action === 'patch_proposal') {
    // { id, status, notes }
    const { id, status, notes } = params;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      status, notes ?? null, id,
    );
    const updated = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
    return res.json({ ok: true, proposal: updated });
  }

  if (action === 'post_proposal') {
    // { feedback_id, title, summary, category, risk, source, proposed_changes }
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      params.feedback_id ?? null,
      params.title,
      params.summary,
      params.category ?? null,
      params.risk || 'medium',
      params.source ?? null,
      params.proposed_changes ? JSON.stringify(params.proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.json({ ok: true, proposal: created });
  }

  if (action === 'post_proposal_message') {
    // { proposal_id, text, user_name }
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?)`,
      params.proposal_id,
      params.user_name || 'AI ассистент',
      params.text,
    );
    return res.json({ ok: true });
  }

  if (action === 'patch_feedback') {
    // { id, status, admin_reply }
    const { id, status, admin_reply } = params;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
      status, admin_reply ?? null, id,
    );
    const updated = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    return res.json({ ok: true, feedback: updated });
  }

  if (action === 'post_feedback_message') {
    // { feedback_id, text, user_name }
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, ?, 'admin', ?, NOW()) RETURNING id, created_at`,
      params.feedback_id,
      params.user_name || 'AI ассистент',
      params.text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown action', known: [
    'patch_proposal', 'post_proposal', 'post_proposal_message',
    'patch_feedback', 'post_feedback_message',
  ] });
}));

export default router;
