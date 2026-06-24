// TEMP: диаг-эндпоинт для ежедневного AI-обхода. Удалить после использования.
// Единственный секрет — в параметре ?secret=. Не трогать prod-данные напрямую.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr2026-06-24-v33-xkB8';

router.use((req, res, next) => {
  if (req.query?.secret === SECRET) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

// GET ?type=proposals[&status=approved|revision|rejected|pending]
// GET ?type=proposal-messages&id=X
// GET ?type=feedback-full  (все open + awaiting_approval с тредами)
router.get('/', asyncHandler(async (req, res) => {
  const type = req.query.type;

  if (type === 'proposals') {
    const where = req.query.status ? 'WHERE p.status = $1' : '';
    const params = req.query.status ? [String(req.query.status)] : [];
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 100`,
      ...params,
    );
    return res.json({ data: rows });
  }

  if (type === 'proposal-messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: rows });
  }

  if (type === 'feedback-full') {
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const result = [];
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      result.push({ ...fb, messages: msgs });
    }
    return res.json({ data: result });
  }

  return res.status(400).json({ error: 'unknown type' });
}));

// POST body: {type, ...fields}
router.post('/', asyncHandler(async (req, res) => {
  const { type } = req.body || {};

  if (type === 'proposal') {
    const d = req.body.data || {};
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      d.feedback_id ?? null,
      d.title,
      d.summary,
      d.category ?? null,
      d.risk || 'medium',
      d.source ?? null,
      d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(created);
  }

  if (type === 'proposal-message') {
    const { proposal_id, text, user_name } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
      Number(proposal_id),
      user_name || 'AI ассистент',
      text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (type === 'feedback-message') {
    const { feedback_id, text, user_name } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
      Number(feedback_id),
      user_name || 'AI ассистент',
      text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown type' });
}));

// PATCH body: {type, id, ...fields}
router.patch('/', asyncHandler(async (req, res) => {
  const { type, id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  if (type === 'proposal') {
    const { decision, notes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision,
      notes ?? null,
      Number(id),
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(id)));
  }

  if (type === 'feedback') {
    const { status, admin_reply } = req.body;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null,
      admin_reply ?? null,
      Number(id),
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', Number(id)));
  }

  return res.status(400).json({ error: 'unknown type' });
}));

export default router;
