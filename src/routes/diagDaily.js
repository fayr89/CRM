// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода обращений.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-03-fbX9p7';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily/feedback-full?secret=... — все обращения open/awaiting с тредами
router.get('/feedback-full', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );
    for (const row of rows) {
      row.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        row.id,
      );
    }
    res.json({ data: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/proposals?secret=...&status=... — ai_proposals по статусу
router.get('/proposals', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const where = req.query.status ? `WHERE status = '${String(req.query.status).replace(/'/g, '')}'` : '';
    const rows = await db.all(
      `SELECT * FROM ai_proposals ${where} ORDER BY created_at DESC`,
    );
    res.json({ data: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/post-msg?secret=...&fb_id=N&text=...
// Постим сообщение от AI ассистента в тред обращения
router.get('/post-msg', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const fbId = Number(req.query.fb_id);
  const text = String(req.query.text || '').trim();
  if (!fbId || !text) return res.status(400).json({ error: 'fb_id and text required' });
  try {
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fbId);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      fbId, text,
    );
    res.json({ ok: true, message_id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/update-feedback?secret=...&fb_id=N&status=...&admin_reply=...
router.get('/update-feedback', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const fbId = Number(req.query.fb_id);
  const status = String(req.query.status || '').trim();
  const adminReply = req.query.admin_reply ? String(req.query.admin_reply).trim() : null;
  const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
  if (!fbId || !allowed.includes(status)) {
    return res.status(400).json({ error: 'fb_id and valid status required' });
  }
  try {
    const cur = await db.get('SELECT id, status FROM feedback WHERE id = ?', fbId);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const justResolved = ['awaiting_approval', 'closed'].includes(status)
      && !['awaiting_approval', 'closed'].includes(cur.status);
    await db.run(
      `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      status, adminReply, fbId,
    );
    res.json({ ok: true, fb_id: fbId, new_status: status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/create-proposal?secret=...&feedback_id=N&title=...&summary=...
//   &category=...&risk=low|medium|high&source=...
router.get('/create-proposal', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const title = String(req.query.title || '').trim();
  const summary = String(req.query.summary || '').trim();
  const category = String(req.query.category || 'other').trim();
  const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
  const source = String(req.query.source || 'daily-run-2026-06-03').trim();
  const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  try {
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedbackId, title, summary, category, risk, source,
    );
    res.json({ ok: true, proposal_id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/patch-proposal?secret=...&id=N&decision=done|approved|rejected
router.get('/patch-proposal', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const id = Number(req.query.id);
  const decision = String(req.query.decision || '').trim();
  const allowed = ['done', 'approved', 'rejected', 'revision'];
  if (!id || !allowed.includes(decision)) {
    return res.status(400).json({ error: 'id and valid decision required' });
  }
  try {
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    res.json({ ok: true, proposal_id: id, new_status: decision });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
