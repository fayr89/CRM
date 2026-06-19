// TEMP: диагностический эндпоинт для AI daily-run 2026-06-19.
// Удалить сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'v6q1rt9bmzxk';
const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

// GET без action → читаем всё нужное за один запрос
router.get('/', asyncHandler(async (req, res) => {
  const action = req.query.action;

  if (!action) {
    // Читаем все данные: proposals по статусам + feedback с тредами
    const [approved, revision, rejected, pending, proposalMessages,
      feedbackRows, feedbackMessages] = await Promise.all([
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                     f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'approved' ORDER BY p.id`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                     f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'revision' ORDER BY p.id`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                     f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'rejected' ORDER BY p.id`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                     f.user_id AS feedback_user_id
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'pending' ORDER BY p.id`),
      db.all(`SELECT * FROM ai_proposal_messages ORDER BY proposal_id, created_at ASC, id ASC`),
      db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
              FROM feedback f LEFT JOIN users u ON u.id = f.user_id
              WHERE f.status IN ('open','awaiting_approval')
              ORDER BY f.created_at DESC`),
      db.all(`SELECT fm.* FROM feedback_messages fm
              JOIN feedback f ON f.id = fm.feedback_id
              WHERE f.status IN ('open','awaiting_approval')
              ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`),
    ]);
    return res.json({
      proposals: { approved, revision, rejected, pending },
      proposal_messages: proposalMessages,
      feedback: feedbackRows,
      feedback_messages: feedbackMessages,
    });
  }

  // Write-операции через GET+action

  if (action === 'post_feedback_msg') {
    const { id, text } = req.query;
    if (!id || !text) return res.status(400).json({ error: 'id и text обязательны' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES ($1, 0, 'AI ассистент', 'admin', $2)`,
      Number(id), text,
    );
    return res.json({ ok: true, action, feedback_id: id });
  }

  if (action === 'update_feedback') {
    const { id, status, admin_reply } = req.query;
    if (!id) return res.status(400).json({ error: 'id обязателен' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = $1', Number(id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
      && !['awaiting_approval', 'closed'].includes(cur.status);
    await db.run(
      `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
       WHERE id = $3`,
      newStatus, admin_reply ?? null, cur.id,
    );
    return res.json({ ok: true, action, id, status: newStatus });
  }

  if (action === 'create_proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title и summary обязательны' });
    let changesJson = null;
    if (proposed_changes) {
      try { changesJson = JSON.parse(proposed_changes); } catch { changesJson = null; }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title, summary,
      category ?? null,
      risk ?? 'medium',
      source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
      changesJson ? JSON.stringify(changesJson) : null,
    );
    return res.json({ ok: true, action, id: r.lastInsertRowid });
  }

  if (action === 'update_proposal') {
    const { id, status, notes } = req.query;
    if (!id || !status) return res.status(400).json({ error: 'id и status обязательны' });
    await db.run(
      `UPDATE ai_proposals SET status = $1,
       admin_notes = COALESCE($2, admin_notes), updated_at = NOW()
       WHERE id = $3`,
      status, notes ?? null, Number(id),
    );
    return res.json({ ok: true, action, id, status });
  }

  if (action === 'post_proposal_msg') {
    const { id, text } = req.query;
    if (!id || !text) return res.status(400).json({ error: 'id и text обязательны' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES ($1, 0, 'AI ассистент', 'admin', $2)`,
      Number(id), text,
    );
    return res.json({ ok: true, action, proposal_id: id });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}));

export default router;
