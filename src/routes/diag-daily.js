// ВРЕМЕННЫЙ diag-эндпоинт для AI-ассистента (ежедневный обход 2026-06-01, сессия N5L8q).
// УДАЛИТЬ сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = 'd4e2b8f1c9a3e750N5L8q';
const router = Router();

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run — всё: ai_proposals + feedback с тредами
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const proposals_approved = await db.all(
      `SELECT * FROM ai_proposals WHERE status='approved' ORDER BY created_at DESC`,
    );
    const proposals_revision = await db.all(
      `SELECT * FROM ai_proposals WHERE status='revision' ORDER BY created_at DESC`,
    );
    const proposals_rejected = await db.all(
      `SELECT * FROM ai_proposals WHERE status='rejected' ORDER BY created_at DESC`,
    );
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at ASC`,
    );
    const threads = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      threads[fb.id] = msgs;
    }
    res.json({ proposals_approved, proposals_revision, proposals_rejected, feedbacks, threads });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/post-msg — POST сообщения в тред (через GET для web_fetch)
// params: feedback_id, text, user_name (default 'AI ассистент')
router.get('/post-msg', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const feedbackId = Number(req.query.feedback_id);
    const text = String(req.query.text || '');
    const userName = String(req.query.user_name || 'AI ассистент');
    if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedbackId);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
      feedbackId, userName, text,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/update-feedback — обновить статус/ответ обращения
// params: id, status, admin_reply
router.get('/update-feedback', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const id = Number(req.query.id);
    const status = req.query.status || null;
    const adminReply = req.query.admin_reply || null;
    if (!id) return res.status(400).json({ error: 'id required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const newStatus = status || cur.status;
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?,admin_reply), updated_at=NOW() WHERE id=?`,
      newStatus, adminReply, id,
    );
    res.json({ ok: true, id, status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/create-proposal — создать ai_proposal
// params: title, summary, category, risk, source, feedback_id, proposed_changes (JSON-encoded)
router.get('/create-proposal', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const title = String(req.query.title || '');
    const summary = String(req.query.summary || '');
    const category = req.query.category || null;
    const risk = req.query.risk || 'medium';
    const source = req.query.source || `daily-run-2026-06-01`;
    const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const proposedChanges = req.query.proposed_changes || null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedbackId, title, summary, category, risk, source, proposedChanges,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/patch-proposal — обновить статус ai_proposal
// params: id, decision (approved|rejected|revision|done), notes
router.get('/patch-proposal', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const id = Number(req.query.id);
    const decision = req.query.decision || '';
    const notes = req.query.notes || null;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    await db.run(
      `UPDATE ai_proposals SET status=?, admin_notes=COALESCE(?,admin_notes), updated_at=NOW() WHERE id=?`,
      decision, notes, id,
    );
    res.json({ ok: true, id, status: decision });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
