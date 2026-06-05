// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного AI-обхода.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-05-v35-mN7qR';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v35?secret=... — все данные для обхода
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC LIMIT 100`,
    );

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC LIMIT 100`,
    );

    const feedbackIds = feedbacks.map(f => f.id);
    let messages = [];
    if (feedbackIds.length > 0) {
      messages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    const msgByFeedback = {};
    for (const m of messages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    for (const f of feedbacks) {
      f.thread = msgByFeedback[f.id] || [];
    }

    res.json({ proposals, feedbacks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v35/feedback-msg?secret=...
// body: { feedback_id, text }
router.post('/feedback-msg', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { feedback_id, text } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      Number(feedback_id),
      String(text),
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-v35/feedback-status?secret=...
// body: { feedback_id, status, admin_reply? }
router.patch('/feedback-status', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      String(status),
      admin_reply ?? null,
      Number(feedback_id),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v35/proposal?secret=...
// body: proposal fields
router.post('/proposal', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null,
      String(title),
      String(summary),
      category ?? null,
      risk || 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-v35/proposal-status?secret=...
// body: { proposal_id, status }
router.patch('/proposal-status', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { proposal_id, status } = req.body;
    if (!proposal_id || !status) return res.status(400).json({ error: 'proposal_id and status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      String(status),
      Number(proposal_id),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
