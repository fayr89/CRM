// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода. УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = '2dad423d689aff7f9738084c30543850';

const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// Все активные обращения с тредом сообщений
router.get('/feedback', async (_req, res) => {
  try {
    const rows = await db.all(`
      SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
             f.created_at, f.updated_at,
             u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','in_progress','awaiting_approval')
      ORDER BY f.created_at DESC
    `);
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    res.json({ data: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Все ai_proposals с фильтром по статусу
router.get('/proposals', async (req, res) => {
  try {
    const allowed = ['pending','approved','revision','rejected','done'];
    const status = req.query.status && allowed.includes(req.query.status)
      ? req.query.status : null;
    const rows = status
      ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`, status)
      : await db.all(`SELECT * FROM ai_proposals ORDER BY created_at DESC`);
    res.json({ data: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Добавить сообщение в тред от «AI ассистент»
// GET /api/diag/daily/msg?secret=X&fid=1&text=Привет...
router.get('/msg', async (req, res) => {
  try {
    const fid = Number(req.query.fid);
    const text = req.query.text;
    if (!fid || !text) return res.status(400).json({ error: 'fid and text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
      fid, text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Сменить статус/reply у feedback
// GET /api/diag/daily/feedback-patch?secret=X&id=1&status=awaiting_approval&reply=...
router.get('/feedback-patch', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const status = req.query.status;
    const reply = req.query.reply || null;
    const allowed = ['open','in_progress','awaiting_approval','closed'];
    if (!id || !status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'id and valid status required' });
    }
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      status, reply, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создать ai_proposal
// GET /api/diag/daily/proposal-create?secret=X&title=...&summary=...&risk=medium&category=feature&feedback_id=1
router.get('/proposal-create', async (req, res) => {
  try {
    const { title, summary, category, risk, source, feedback_id } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const allowedRisk = ['low','medium','high'];
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending') RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title,
      summary,
      category || 'feature',
      allowedRisk.includes(risk) ? risk : 'medium',
      source || 'daily-run-2026-06-03',
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Пометить ai_proposal решением
// GET /api/diag/daily/proposal-patch?secret=X&id=1&decision=done
router.get('/proposal-patch', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    const allowed = ['approved','rejected','revision','done','pending'];
    if (!id || !allowed.includes(decision)) {
      return res.status(400).json({ error: 'id and valid decision required' });
    }
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
