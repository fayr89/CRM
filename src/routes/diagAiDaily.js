// ВРЕМЕННЫЙ диаг-эндпоинт для ежедневного обхода AI-ассистента.
// Удалить сразу после завершения обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'f5c2b8e1a4d7';

router.use((req, res, next) => {
  if (req.query?.tok !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: null, role: 'admin', name: 'AI ассистент' };
  next();
});

// Полный дамп: proposals по статусам + открытые feedback с тредами
router.get('/dump', asyncHandler(async (_req, res) => {
  const statuses = ['approved', 'revision', 'rejected', 'pending'];
  const proposals = {};
  for (const st of statuses) {
    const rows = await db.all(
      `SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`,
      st,
    );
    for (const p of rows) {
      p.messages = await db.all(
        `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }
    proposals[st] = rows;
  }

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const fb of feedback) {
    fb.messages = await db.all(
      `SELECT id, user_name, role, text, created_at FROM feedback_messages
       WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({ proposals, feedback });
}));

// Отметить proposal выполненным
router.get('/proposal-done', asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  await db.run(
    `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
    id,
  );
  res.json({ ok: true, id });
}));

// Создать новый proposal
router.get('/proposal-new', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source } = req.query;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    feedback_id ? Number(feedback_id) : null,
    title,
    summary,
    category || null,
    risk || 'medium',
    source || null,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// Пост сообщения в тред предложения
router.get('/proposal-msg', asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  const text = req.query.text;
  if (!id || !text) return res.status(400).json({ error: 'id and text required' });
  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
    id,
    text,
  );
  res.json({ ok: true });
}));

// Пост сообщения в тред обращения
router.get('/feedback-msg', asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  const text = req.query.text;
  if (!id || !text) return res.status(400).json({ error: 'id and text required' });
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
    id,
    text,
  );
  res.json({ ok: true });
}));

// Обновить статус/ответ обращения
router.get('/feedback-update', asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  const status = req.query.status;
  const reply = req.query.reply || null;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW()
     WHERE id = ?`,
    status,
    reply,
    id,
  );
  res.json({ ok: true });
}));

export default router;
