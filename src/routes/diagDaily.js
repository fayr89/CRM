// TEMP: ежедневный диаг-эндпоинт (сессия 6QKJK). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'a-VrQPLam-r8TJ9DNWbQFMUB0T7QH2cw';

function checkSecret(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(checkSecret);

// Все feedback open/awaiting_approval с threads
router.get('/feedback', async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    for (const f of rows) {
      f.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        f.id,
      );
    }
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ai_proposals по статусу
router.get('/proposals', async (req, res) => {
  try {
    const status = req.query.status;
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
       ${status ? `WHERE p.status = '${status.replace(/'/g, '')}'` : ''}
       ORDER BY p.created_at DESC LIMIT 100`,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST сообщение в thread feedback
router.post('/feedback/:id/message', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      Number(req.params.id), text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH статус feedback
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null, Number(req.params.id),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST создать ai_proposal
router.post('/proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk ?? 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH ai_proposal — статус done/pending и т.д.
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { decision, notes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, Number(req.params.id),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
