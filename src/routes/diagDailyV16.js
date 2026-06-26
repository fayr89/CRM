// Временный диагностический эндпоинт для ежедневного обхода AI-ассистента.
// УДАЛИТЬ после использования (отдельным коммитом).
// Секрет: diag-daily-v16-20260626
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'diag-daily-v16-20260626';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v16?secret=X — все данные для ежедневного обхода
router.get('/', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const [approved, revision, rejected, pending] = await Promise.all([
    db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC LIMIT 20`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC`),
  ]);

  // Треды для approved, revision, pending (нужны для контекста)
  const proposalIds = [...approved, ...revision, ...pending].map(p => p.id);
  let proposalMessages = {};
  if (proposalIds.length) {
    const msgs = await db.all(
      `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[]) ORDER BY created_at ASC, id ASC`,
      proposalIds,
    );
    for (const m of msgs) {
      if (!proposalMessages[m.proposal_id]) proposalMessages[m.proposal_id] = [];
      proposalMessages[m.proposal_id].push(m);
    }
  }

  // Обращения: open и awaiting_approval с тредами
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );

  let feedbackMessages = {};
  if (feedbacks.length) {
    const fbIds = feedbacks.map(f => f.id);
    const msgs = await db.all(
      `SELECT id, feedback_id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ANY(?::int[]) ORDER BY created_at ASC, id ASC`,
      fbIds,
    );
    for (const m of msgs) {
      if (!feedbackMessages[m.feedback_id]) feedbackMessages[m.feedback_id] = [];
      feedbackMessages[m.feedback_id].push(m);
    }
  }

  res.json({
    proposals: {
      approved: approved.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
      revision: revision.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
      rejected,
      pending: pending.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
    },
    feedbacks: feedbacks.map(f => ({ ...f, messages: feedbackMessages[f.id] || [] })),
  });
}));

// POST /api/diag/daily-v16/op?secret=X — операции записи
// Body: { op, ...params }
// Поддерживаемые op:
//   patch_proposal   { id, decision, notes? }
//   post_proposal_msg { id, text }
//   create_proposal  { title, summary, category, risk, source, proposed_changes, feedback_id? }
//   patch_feedback   { id, status, admin_reply? }
//   post_feedback_msg { id, text }
//   close_feedback   { id, reason }
router.post('/op', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { op, ...params } = req.body || {};

  if (op === 'patch_proposal') {
    const { id, decision, notes } = params;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json({ ok: true, id, decision });
  }

  if (op === 'post_proposal_msg') {
    const { id, text } = params;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'create_proposal') {
    const { title, summary, category, risk, source, proposed_changes, feedback_id } = params;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null,
      title,
      summary,
      category ?? null,
      risk || 'medium',
      source ?? 'daily-run-2026-06-26',
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const row = await db.get('SELECT id, title, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json({ ok: true, proposal: row });
  }

  if (op === 'patch_feedback') {
    const { id, status, admin_reply } = params;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      newStatus,
      admin_reply ?? null,
      id,
    );
    return res.json({ ok: true, id, status: newStatus });
  }

  if (op === 'post_feedback_msg') {
    const { id, text } = params;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown op', op });
}));

export default router;
