// TEMPORARY — ежедневный AI-обход. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'd26601f9e04633e54e9bcfe87f07c4d4';

function guard(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(guard);

// GET /api/diag/daily/proposals?status=approved|revision|rejected|pending
router.get('/proposals', async (req, res) => {
  try {
    const where = req.query.status ? 'WHERE p.status = $1' : '';
    const params = req.query.status ? [req.query.status] : [];
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 200`,
      ...params,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/diag/daily/proposals — создать proposal
router.post('/proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PATCH /api/diag/daily/proposals/:id — обновить статус
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { decision, notes } = req.body;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, req.params.id,
    );
    const updated = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/diag/daily/feedback — все open/awaiting_approval с тредами
router.get('/feedback', async (req, res) => {
  try {
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 200`,
    );
    const ids = feedbacks.map(f => f.id);
    let messages = [];
    if (ids.length > 0) {
      messages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(?) ORDER BY created_at ASC`,
        ids,
      );
    }
    const byId = {};
    for (const f of feedbacks) byId[f.id] = { ...f, thread: [] };
    for (const m of messages) {
      if (byId[m.feedback_id]) byId[m.feedback_id].thread.push(m);
    }
    res.json({ data: Object.values(byId) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/diag/daily/feedback/closed — все closed/rejected за последние 7 дней
router.get('/feedback/closed', async (req, res) => {
  try {
    const feedbacks = await db.all(
      `SELECT f.id, f.subject, f.status, f.created_at
       FROM feedback f
       WHERE f.status NOT IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 50`,
    );
    res.json({ data: feedbacks });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/diag/daily/feedback/:id/message — добавить сообщение в тред
router.post('/feedback/:id/message', async (req, res) => {
  try {
    const { text, user_name } = req.body;
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
       VALUES (?, ?, 'admin', ?)`,
      req.params.id, user_name || 'AI ассистент', text,
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// PATCH /api/diag/daily/feedback/:id/status — обновить статус обращения
router.patch('/feedback/:id/status', async (req, res) => {
  try {
    const { status, admin_reply } = req.body;
    if (admin_reply !== undefined) {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
        status, admin_reply, req.params.id,
      );
    } else {
      await db.run(
        `UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`,
        status, req.params.id,
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
