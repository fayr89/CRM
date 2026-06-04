// TEMP: диаг-эндпоинт для AI-обхода daily-run 2026-06-04-v2. СНЕСТИ ПОСЛЕ ИСПОЛЬЗОВАНИЯ.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr2-x9kQmP4nLsV7';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

router.use(checkSecret);

// GET /api/diag/daily-v2/ai-proposals?status=approved
router.get('/ai-proposals', async (req, res) => {
  try {
    const where = req.query.status ? `WHERE status = '${req.query.status.replace(/'/g, '')}'` : '';
    const rows = await db.all(`SELECT * FROM ai_proposals ${where} ORDER BY created_at DESC LIMIT 100`);
    res.json({ data: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-v2/ai-proposals/:id
router.patch('/ai-proposals/:id', async (req, res) => {
  try {
    const { decision, notes } = req.body || {};
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, req.params.id
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v2/ai-proposals
router.post('/ai-proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-v2/feedback-full
router.get('/feedback-full', async (req, res) => {
  try {
    const feedbacks = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.updated_at DESC LIMIT 100
    `);
    const ids = feedbacks.map(f => f.id);
    let messages = [];
    if (ids.length > 0) {
      messages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(?::int[]) ORDER BY created_at ASC`,
        `{${ids.join(',')}}`
      );
    }
    const msgByFeedback = {};
    for (const m of messages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    res.json({ data: feedbacks.map(f => ({ ...f, thread: msgByFeedback[f.id] || [] })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v2/feedback-messages
router.post('/feedback-messages', async (req, res) => {
  try {
    const { feedback_id, message, user_name } = req.body || {};
    if (!feedback_id || !message) return res.status(400).json({ error: 'feedback_id and message required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, message, created_at)
       VALUES (?, NULL, ?, 'admin', ?, NOW()) RETURNING id`,
      feedback_id, user_name || 'AI ассистент', message
    );
    const row = await db.get('SELECT * FROM feedback_messages WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-v2/feedback/:id
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body || {};
    const sets = [];
    const vals = [];
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (admin_reply !== undefined) { sets.push('admin_reply = ?'); vals.push(admin_reply); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.id);
    await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const row = await db.get(`SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.id=?`, req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
