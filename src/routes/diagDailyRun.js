// TEMP: диаг-эндпоинт ежедневного обхода AI (2026-06-20). Снести после использования.
// Секрет: d8f3c1a7e2b9k5m4
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'd8f3c1a7e2b9k5m4';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET: все данные для обхода
router.get('/', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status IN ('approved','rejected','revision','pending')
     ORDER BY p.created_at DESC LIMIT 100`,
  );
  const proposalIds = proposals.map(p => p.id);
  const proposalMessages = proposalIds.length
    ? await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      )
    : [];

  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const fbIds = feedbacks.map(f => f.id);
  const fbMessages = fbIds.length
    ? await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      )
    : [];

  res.json({ proposals, proposal_messages: proposalMessages, feedbacks, feedback_messages: fbMessages });
}));

// POST: действия
router.post('/', asyncHandler(async (req, res) => {
  const { action } = req.body || {};

  if (action === 'feedback_message') {
    const { feedback_id, text } = req.body;
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      feedback_id, text,
    );
    return res.json({ ok: true });
  }

  if (action === 'feedback_update') {
    const { feedback_id, status, admin_reply } = req.body;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_by = CASE WHEN ? THEN 0 ELSE resolved_by END,
       resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
       updated_at = NOW() WHERE id = ?`,
      status || cur.status,
      admin_reply ?? null,
      justResolved, justResolved,
      feedback_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'feedback_close') {
    const { feedback_id, text } = req.body;
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      feedback_id, text,
    );
    await db.run(
      `UPDATE feedback SET status = 'closed', resolved_by = 0, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      feedback_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal_done') {
    const { proposal_id } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = 'done', admin_decision_by = 0, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      proposal_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal_create') {
    const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'proposal_revision') {
    const { proposal_id, summary, title } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = 'pending', summary = COALESCE(?, summary), title = COALESCE(?, title), updated_at = NOW() WHERE id = ?`,
      summary ?? null, title ?? null, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal_message') {
    const { proposal_id, text } = req.body;
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      proposal_id, text,
    );
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
