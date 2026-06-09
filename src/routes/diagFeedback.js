// TEMP: ежедневный обход обращений AI-ассистентом 2026-06-09-v55. Удалить после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'b7e3f1a9d4c2e8b5f0a7d3c9e1b6f4a2';

function guard(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// Все открытые/ожидающие обращения с тредами сообщений
router.get('/feedback-full', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const rows = await db.all(
    `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
            f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
     ORDER BY f.created_at DESC
     LIMIT 100`,
  );
  const result = [];
  for (const row of rows) {
    const messages = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      row.id,
    );
    result.push({ ...row, messages });
  }
  res.json({ data: result, count: result.length });
}));

// AI-предложения по статусу с тредами
router.get('/ai-proposals', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await db.all(
    `SELECT p.*, f.subject AS feedback_subject
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ${status ? 'WHERE p.status = ?' : ''}
     ORDER BY p.created_at DESC LIMIT 100`,
    ...(status ? [status] : []),
  );
  const result = [];
  for (const row of rows) {
    const messages = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      row.id,
    );
    result.push({ ...row, messages });
  }
  res.json({ data: result, count: result.length });
}));

// Добавить сообщение в тред обращения (user_name = 'AI ассистент')
router.get('/post-feedback-msg', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const feedbackId = Number(req.query.feedback_id);
  const text = req.query.text ? String(req.query.text).trim() : null;
  if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedbackId);
  if (!fb) return res.status(404).json({ error: 'feedback not found' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    feedbackId, text,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// Обновить статус обращения
router.get('/update-feedback', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const status = req.query.status ? String(req.query.status).trim() : null;
  const reply = req.query.reply ? String(req.query.reply).trim() : null;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
    status, reply ?? null, id,
  );
  res.json({ ok: true, id, status });
}));

// Создать ai_proposal
router.get('/create-proposal', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const title = req.query.title ? String(req.query.title).trim() : null;
  const summary = req.query.summary ? String(req.query.summary).trim() : null;
  const category = req.query.category || 'feature';
  const risk = req.query.risk || 'medium';
  const source = req.query.source || 'daily-run-2026-06-09';
  const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
  const changes = req.query.changes ? String(req.query.changes).trim() : null;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedbackId ?? null, title, summary, category, risk, source,
    changes ?? null,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// Обновить статус ai_proposal
router.get('/update-proposal', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const decision = req.query.decision ? String(req.query.decision).trim() : null;
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
  const allowed = ['approved', 'rejected', 'revision', 'done', 'pending'];
  if (!allowed.includes(decision)) return res.status(400).json({ error: 'invalid decision' });
  await db.run(
    `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
    decision, id,
  );
  res.json({ ok: true, id, status: decision });
}));

// Добавить сообщение в тред proposal
router.get('/post-proposal-msg', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const proposalId = Number(req.query.proposal_id);
  const text = req.query.text ? String(req.query.text).trim() : null;
  if (!proposalId || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const prop = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposalId);
  if (!prop) return res.status(404).json({ error: 'proposal not found' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    proposalId, text,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

export default router;
