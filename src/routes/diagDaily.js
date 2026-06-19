// TEMPORARY — AI daily-run 2026-06-19 z4x8n1 — удалить после использования
import { Router } from 'express';
import { db } from '../db.js';

const DAILY_SECRET = 'z4x8n1';
const router = Router();

router.use((req, res, next) => {
  if (req.query.s !== DAILY_SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// Все обращения со статусами open и awaiting_approval, включая треды
router.get('/feedback-full', async (_req, res) => {
  try {
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const ids = feedbacks.map((f) => f.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT feedback_id, id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${ids.join(',')}}`,
      );
    }
    const byId = {};
    for (const m of messages) {
      if (!byId[m.feedback_id]) byId[m.feedback_id] = [];
      byId[m.feedback_id].push(m);
    }
    res.json({ data: feedbacks.map((f) => ({ ...f, thread: byId[f.id] || [] })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// AI proposals по статусу
router.get('/proposals', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const rows = status
      ? await db.all(
          `SELECT p.*, f.subject AS feedback_subject
           FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
           WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`,
          status,
        )
      : await db.all(
          `SELECT p.*, f.subject AS feedback_subject
           FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
           ORDER BY p.created_at DESC LIMIT 100`,
        );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Тред proposal
router.get('/proposals/:id/messages', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      id,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создать proposal (параметры через query)
router.get('/post-proposal', async (req, res) => {
  try {
    const { title, summary, category, risk, source, feedback_id } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      String(title),
      String(summary),
      category ? String(category) : 'feature',
      risk ? String(risk) : 'medium',
      source ? String(source) : 'daily-run-2026-06-19',
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Обновить статус proposal
router.get('/patch-proposal', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const decision = String(req.query.decision || '');
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      decision,
      id,
    );
    res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить сообщение в тред proposal
router.get('/post-proposal-msg', async (req, res) => {
  try {
    const id = Number(req.query.proposal_id);
    const text = req.query.text ? String(req.query.text) : '';
    if (!id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
      id,
      text,
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить сообщение в тред feedback
router.get('/post-feedback-msg', async (req, res) => {
  try {
    const feedback_id = Number(req.query.feedback_id);
    const text = req.query.text ? String(req.query.text) : '';
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id,
      text,
    );
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Обновить статус и/или admin_reply обращения
router.get('/patch-feedback', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const status = req.query.status ? String(req.query.status) : null;
    const admin_reply = req.query.admin_reply ? String(req.query.admin_reply) : null;
    if (!id) return res.status(400).json({ error: 'id required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status || cur.status;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      newStatus,
      admin_reply,
      id,
    );
    res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
