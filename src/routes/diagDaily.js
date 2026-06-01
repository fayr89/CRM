// ВРЕМЕННЫЙ diag-эндпоинт для AI-обхода 2026-06-01 (сессия qyrNx).
// Удалить сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-qyrNx-2026-06-01-daily';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=...&action=proposals&status=approved
// GET /api/diag/daily?secret=...&action=feedback-full
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { action, status } = req.query;
    if (action === 'proposals') {
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }
    if (action === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC`,
      );
      const result = [];
      for (const fb of feedbacks) {
        const messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, messages });
      }
      return res.json({ data: result });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily?secret=...
// Body: { action, ...payload }
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { action } = req.body;

    if (action === 'create-proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id ?? null,
        title,
        summary,
        category ?? null,
        risk || 'medium',
        source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (action === 'patch-proposal') {
      const { id, decision, notes } = req.body;
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3`,
        decision,
        notes ?? null,
        id,
      );
      const updated = await db.get('SELECT * FROM ai_proposals WHERE id = $1', id);
      return res.json(updated);
    }

    if (action === 'patch-feedback') {
      const { id, status, admin_reply } = req.body;
      await db.run(
        `UPDATE feedback SET
           status = COALESCE($1, status),
           admin_reply = COALESCE($2, admin_reply),
           updated_at = NOW()
         WHERE id = $3`,
        status ?? null,
        admin_reply ?? null,
        id,
      );
      const updated = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      return res.json(updated);
    }

    if (action === 'post-message') {
      const { feedback_id, text } = req.body;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, NULL, 'AI ассистент', 'admin', $2) RETURNING id`,
        feedback_id,
        text,
      );
      const created = await db.get(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE id = $1`,
        r.lastInsertRowid,
      );
      return res.status(201).json(created);
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
