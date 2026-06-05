// TEMP — ежедневный AI-обход. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = 'dr-v37-june5';
const router = Router();

function checkSecret(req, res, next) {
  if (req.query.s !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(checkSecret);

// Получить всё: ai_proposals + open/awaiting_approval feedback с тредами
router.get('/', async (_req, res) => {
  try {
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.created_at DESC LIMIT 100`,
    );
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    let messages = [];
    if (feedback.length) {
      const placeholders = feedback.map((_, i) => `?`).join(',');
      const ids = feedback.map(f => f.id);
      messages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id IN (${placeholders}) ORDER BY created_at ASC`,
        ...ids,
      );
    }
    const msgsByFb = {};
    for (const m of messages) {
      if (!msgsByFb[m.feedback_id]) msgsByFb[m.feedback_id] = [];
      msgsByFb[m.feedback_id].push(m);
    }
    res.json({
      proposals,
      feedback: feedback.map(f => ({ ...f, messages: msgsByFb[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH ai_proposal — обновить статус (decision: done/pending/etc.)
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { status, admin_notes } = req.body || {};
    await db.run(
      `UPDATE ai_proposals SET
       status = COALESCE(?, status),
       admin_notes = COALESCE(?, admin_notes),
       updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_notes ?? null, Number(req.params.id),
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST ai_proposal — создать новое предложение
router.post('/proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH feedback — обновить статус / admin_reply
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body || {};
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

// POST feedback message — добавить сообщение в тред
router.post('/feedback/:id/msg', async (req, res) => {
  try {
    const { message, user_name } = req.body || {};
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, message, created_at)
       VALUES (?, ?, 'admin', ?, NOW()) RETURNING id`,
      Number(req.params.id), user_name || 'AI ассистент', message,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
