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

// GET /create-proposal?data=<base64_json> — создать ai_proposal
router.get('/create-proposal', async (req, res) => {
  try {
    const raw = req.query.data;
    if (!raw) return res.status(400).json({ error: 'data required' });
    const data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = data;
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

// GET /patch-proposal?id=...&decision=...&notes=<base64> — обновить ai_proposal
router.get('/patch-proposal', async (req, res) => {
  try {
    const { id, decision, notes } = req.query;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    const notesDecoded = notes ? Buffer.from(notes, 'base64').toString('utf8') : null;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notesDecoded, id,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /post-message?fb_id=...&text=<base64> — написать в тред от AI ассистента
router.get('/post-message', async (req, res) => {
  try {
    const { fb_id, text } = req.query;
    if (!fb_id || !text) return res.status(400).json({ error: 'fb_id and text required' });
    const textDecoded = Buffer.from(text, 'base64').toString('utf8');
    const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', fb_id);
    if (!fb) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
      fb.id, textDecoded,
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

// GET /delete-message?msg_id=... — удалить сообщение треда
router.get('/delete-message', async (req, res) => {
  try {
    const { msg_id } = req.query;
    if (!msg_id) return res.status(400).json({ error: 'msg_id required' });
    const result = await db.run('DELETE FROM feedback_messages WHERE id = ?', msg_id);
    res.json({ deleted: result.changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /patch-feedback?fb_id=...&status=...&reply=<base64> — сменить статус / ответить
router.get('/patch-feedback', async (req, res) => {
  try {
    const { fb_id, status, reply } = req.query;
    if (!fb_id) return res.status(400).json({ error: 'fb_id required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fb_id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const replyDecoded = reply ? Buffer.from(reply, 'base64').toString('utf8') : null;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      newStatus, replyDecoded, cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
