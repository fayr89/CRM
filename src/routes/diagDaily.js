// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const DIAG_SECRET = '63f541f92281e9bd4f31f3b76892d5db25cd1354';

function checkSecret(req, res, next) {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

router.use(checkSecret);

// Получить ai_proposals по статусу + все open/awaiting_approval feedback с тредами
router.get('/data', async (req, res) => {
  try {
    const [approved, revision, rejected, feedbacks] = await Promise.all([
      db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC`),
      db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
              FROM feedback f LEFT JOIN users u ON u.id = f.user_id
              WHERE f.status IN ('open','awaiting_approval','in_progress')
              ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END), f.created_at DESC`),
    ]);
    const fbWithThreads = await Promise.all(feedbacks.map(async (fb) => {
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      return { ...fb, messages };
    }));
    res.json({ approved, revision, rejected, feedbacks: fbWithThreads });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH ai_proposals/:id — выставить decision
router.patch('/ai-proposals/:id', async (req, res) => {
  try {
    const { decision, notes } = req.body || {};
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, req.params.id,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST ai_proposals — создать
router.post('/ai-proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null, risk || 'medium',
      source ?? null, proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST feedback/:id/messages — написать в тред от AI ассистента
router.post('/feedback/:id/messages', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', req.params.id);
    if (!fb) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
      fb.id, text,
    );
    const msg = await db.get(
      `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE id = ?`,
      r.lastInsertRowid,
    );
    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH feedback/:id — сменить статус и/или admin_reply
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body || {};
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      newStatus, admin_reply ?? null, cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
