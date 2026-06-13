// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода обращений.
// Удалить сразу после использования (отдельным коммитом).
// Секрет одноразовый: drun_9b4f2e7c1a
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'drun_9b4f2e7c1a';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET — вся нужная для обхода информация
router.get('/', asyncHandler(async (_req, res) => {
  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.created_at ASC`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status != 'done'
     ORDER BY p.created_at DESC`,
  );
  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  res.json({ feedbacks, proposals });
}));

// POST — операции: feedback_message, feedback_update, create_proposal,
//                  update_proposal, proposal_message
router.post('/', asyncHandler(async (req, res) => {
  const { action, ...payload } = req.body || {};

  if (action === 'feedback_message') {
    const { feedback_id, text } = payload;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'feedback_update') {
    const { feedback_id, status, admin_reply } = payload;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = CASE WHEN ? IS NOT NULL AND status NOT IN ('awaiting_approval','closed')
                            THEN 0 ELSE resolved_by END,
         resolved_at = CASE WHEN ? IS NOT NULL AND status NOT IN ('awaiting_approval','closed')
                            THEN NOW() ELSE resolved_at END,
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null,
      status ?? null, status ?? null,
      feedback_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'create_proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = payload;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'update_proposal') {
    const { proposal_id, decision, notes } = payload;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal_message') {
    const { proposal_id, text } = payload;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      proposal_id, text,
    );
    return res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }

  res.status(400).json({ error: 'unknown action' });
}));

export default router;
