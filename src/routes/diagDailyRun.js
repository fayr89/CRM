// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования отдельным коммитом.
// Секрет: 7k9Qx4pL — одноразовый, только для этой сессии.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7k9Qx4pL';

router.use((req, res, next) => {
  if (req.query.tok !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET: читаем данные
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query.q;

  if (q === 'proposals') {
    const status = req.query.status || null;
    const rows = status
      ? await db.all(
          `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                  fu.name AS feedback_author_name
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           LEFT JOIN users fu ON fu.id = f.user_id
           WHERE p.status = ?
           ORDER BY p.created_at DESC`,
          status,
        )
      : await db.all(
          `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                  fu.name AS feedback_author_name
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           LEFT JOIN users fu ON fu.id = f.user_id
           ORDER BY p.created_at DESC`,
        );
    return res.json({ data: rows });
  }

  if (q === 'feedback-full') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const withThreads = await Promise.all(rows.map(async (fb) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      return { ...fb, messages: msgs };
    }));
    return res.json({ data: withThreads });
  }

  if (q === 'proposal-messages') {
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

  return res.status(400).json({ error: 'unknown q' });
}));

// POST: мутации
router.post('/', asyncHandler(async (req, res) => {
  const { op } = req.body || {};

  if (op === 'create-proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null,
      title,
      summary,
      category ?? null,
      risk ?? 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(created);
  }

  if (op === 'patch-proposal') {
    const { id, decision, notes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
  }

  if (op === 'patch-feedback') {
    const { id, status, admin_reply } = req.body;
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
      newStatus, admin_reply ?? null, id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
  }

  if (op === 'post-feedback-message') {
    const { feedback_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'post-proposal-message') {
    const { proposal_id, text } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      proposal_id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown op' });
}));

export default router;
