// ВРЕМЕННЫЙ диагностический роут для AI daily-run 2026-06-20.
// Секрет одноразовый — удалить этот файл СРАЗУ после использования.
// Удаление: отдельный коммит «chore: снести временный diag-эндпоинт».
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DAILY_SECRET = 'ai2026j20run9k4m';
const router = Router();

router.use((req, res, next) => {
  const s = req.query.secret || req.body?.secret;
  if (s !== DAILY_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET?action=feedback-full  — все open + awaiting_approval обращения с тредами
// GET?action=proposals&status=X — ai_proposals по статусу
// GET?action=proposal-messages&id=N — тред предложения
// GET?action=pending-proposals — все pending с тредами
router.get('/', asyncHandler(async (req, res) => {
  const action = req.query.action;

  if (action === 'feedback-full') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC
       LIMIT 100`,
    );
    const withThreads = await Promise.all(rows.map(async (fb) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      return { ...fb, messages: msgs };
    }));
    return res.json({ data: withThreads });
  }

  if (action === 'proposals') {
    const status = req.query.status;
    const rows = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${status ? 'WHERE p.status = $1' : ''}
       ORDER BY p.created_at DESC
       LIMIT 50`,
      ...(status ? [status] : []),
    );
    return res.json({ data: rows });
  }

  if (action === 'proposal-messages') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ data: msgs });
  }

  if (action === 'pending-proposals') {
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC LIMIT 50`,
    );
    const withThreads = await Promise.all(rows.map(async (p) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      return { ...p, messages: msgs };
    }));
    return res.json({ data: withThreads });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

// POST для всех write-операций
// body.action = 'feedback-message' | 'feedback-status' | 'proposal-create' |
//               'proposal-decision' | 'proposal-message'
router.post('/', asyncHandler(async (req, res) => {
  const { action } = req.body;
  const FAKE_ADMIN = { id: 1, role: 'admin', name: 'AI ассистент' };

  if (action === 'feedback-message') {
    const { feedback_id, text } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = ?', feedback_id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      fb.id, FAKE_ADMIN.id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (action === 'feedback-status') {
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?,
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      status, admin_reply ?? null,
      justResolved ? FAKE_ADMIN.id : cur.resolved_by,
      feedback_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal-create') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk ?? 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (action === 'proposal-decision') {
    const { proposal_id, decision } = req.body;
    if (!proposal_id || !decision) return res.status(400).json({ error: 'proposal_id and decision required' });
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposal_id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, FAKE_ADMIN.id, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (action === 'proposal-message') {
    const { proposal_id, text } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposal_id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      proposal_id, FAKE_ADMIN.id, text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
