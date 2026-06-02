// TEMP: ежедневный диаг-эндпоинт (сессия 6QKJK). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'a-VrQPLam-r8TJ9DNWbQFMUB0T7QH2cw';

function checkSecret(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(checkSecret);

// Все feedback open/awaiting_approval/in_progress с threads
router.get('/feedback', async (_req, res) => {
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    for (const f of rows) {
      f.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        f.id,
      );
    }
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ai_proposals по статусу
router.get('/proposals', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).replace(/[^a-z_]/g, '') : null;
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
       ${status ? `WHERE p.status = '${status}'` : ''}
       ORDER BY p.created_at DESC LIMIT 100`,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- WRITE OPERATIONS via GET (web_fetch_vercel_url поддерживает только GET) ----

// Поставить статус feedback: ?id=N&status=awaiting_approval&reply=text
router.get('/do/feedback-status', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const status = String(req.query.status || '').replace(/[^a-z_]/g, '');
    const reply = req.query.reply ? String(req.query.reply) : null;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      status, reply, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Постить сообщение в thread: ?id=N&text=...
router.get('/do/feedback-msg', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const text = req.query.text ? String(req.query.text) : null;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Создать ai_proposal (параметры в query — всё %-encoded): ?title=...&summary=...&category=...&risk=...&source=...&fid=N
router.get('/do/new-proposal', async (req, res) => {
  try {
    const { title, summary, category, risk, source } = req.query;
    const fid = req.query.fid ? Number(req.query.fid) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      fid ?? null,
      String(title),
      String(summary),
      category ? String(category) : null,
      risk ? String(risk) : 'medium',
      source ? String(source) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Отметить proposal done: ?id=N
router.get('/do/proposal-done', async (req, res) => {
  try {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
