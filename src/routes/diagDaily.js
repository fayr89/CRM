// ВРЕМЕННЫЙ эндпоинт для AI-ежедневного обхода. УДАЛИТЬ после использования.
// Все операции через GET + секрет в query-параметре ?s=...
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'p4w7y2c6n3';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const { op, id, status, decision, notes, title, summary, category, risk, source, feedback_id, proposed_changes, text, reply } = req.query;

  // --- Чтение ---

  if (op === 'proposals') {
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${status ? 'WHERE p.status = ?' : ''}
       ORDER BY p.created_at DESC`,
      ...(status ? [status] : []),
    );
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    return res.json({ data: rows });
  }

  if (op === 'feedback') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ${status ? 'WHERE f.status = ?' : ''}
       ORDER BY f.created_at DESC`,
      ...(status ? [status] : []),
    );
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    return res.json({ data: rows });
  }

  // --- Запись: proposals ---

  if (op === 'proposal_done') {
    await db.run(
      `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
      Number(id),
    );
    return res.json({ ok: true, id });
  }

  if (op === 'proposal_create') {
    let changes = null;
    try { changes = proposed_changes ? JSON.parse(proposed_changes) : null; } catch { changes = null; }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title || '(без заголовка)',
      summary || '',
      category ?? null,
      risk || 'medium',
      source ?? 'daily-run-2026-06-19',
      changes ? JSON.stringify(changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'proposal_message') {
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      Number(id), text || '',
    );
    return res.json({ ok: true });
  }

  if (op === 'proposal_update') {
    // Переработать summary/title для revision
    const fields = [];
    const vals = [];
    if (title) { fields.push('title = ?'); vals.push(title); }
    if (summary) { fields.push('summary = ?'); vals.push(summary); }
    if (status) { fields.push('status = ?'); vals.push(status); }
    if (!fields.length) return res.json({ ok: false, error: 'nothing to update' });
    fields.push('updated_at = NOW()');
    await db.run(`UPDATE ai_proposals SET ${fields.join(', ')} WHERE id = ?`, ...vals, Number(id));
    return res.json({ ok: true });
  }

  // --- Запись: feedback ---

  if (op === 'feedback_status') {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      newStatus, reply ?? null, cur.id,
    );
    return res.json({ ok: true, id });
  }

  if (op === 'feedback_message') {
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', Number(id));
    if (!fb) return res.status(404).json({ error: 'not found' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      fb.id, text || '',
    );
    return res.json({ ok: true });
  }

  if (op === 'feedback_close') {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    await db.run(
      `UPDATE feedback SET status = 'closed', admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      reply ?? null, cur.id,
    );
    return res.json({ ok: true });
  }

  return res.json({
    ops: ['proposals', 'feedback', 'proposal_done', 'proposal_create', 'proposal_message',
      'proposal_update', 'feedback_status', 'feedback_message', 'feedback_close'],
  });
}));

export default router;
