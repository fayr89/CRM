// TEMP: daily-run diag endpoint (сессия dMU44). Удалить после обхода.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'pQ7bW2mX9nR4kL6tJf8vZc3sYe5hUg1a';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-dMU44?secret=...&action=...
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || 'get-feedback';

  try {
    // --- get-proposals?status=approved|revision|rejected|pending ---
    if (action === 'get-proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`,
        status,
      );
      return res.json({ action, status, data: rows });
    }

    // --- patch-proposal?id=X&decision=done ---
    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
      return res.json({ action, updated: row });
    }

    // --- get-feedback (open + awaiting_approval + in_progress, с thread) ---
    if (action === 'get-feedback') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.message, f.category,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                  f.created_at DESC
         LIMIT 100`,
      );
      const ids = rows.map(r => r.id);
      let messages = [];
      if (ids.length) {
        messages = await db.all(
          `SELECT feedback_id, id, user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY(?::int[])
           ORDER BY created_at ASC, id ASC`,
          `{${ids.join(',')}}`,
        );
      }
      const msgMap = {};
      for (const m of messages) {
        if (!msgMap[m.feedback_id]) msgMap[m.feedback_id] = [];
        msgMap[m.feedback_id].push(m);
      }
      const result = rows.map(r => ({ ...r, thread: msgMap[r.id] || [] }));
      return res.json({ action, total: result.length, data: result });
    }

    // --- patch-feedback?id=X&status=awaiting_approval&reply=URL_ENCODED_TEXT ---
    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply ? decodeURIComponent(req.query.reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        newStatus, reply, id,
      );
      return res.json({ action, id, status: newStatus });
    }

    // --- post-message?feedback_id=X&text=URL_ENCODED_TEXT ---
    if (action === 'post-message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : '';
      if (!feedbackId || !text.trim()) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedbackId);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedbackId, text.trim(),
      );
      return res.json({ action, feedback_id: feedbackId, message_id: r.lastInsertRowid });
    }

    // --- post-proposal?data=BASE64_JSON ---
    if (action === 'post-proposal') {
      const raw = req.query.data ? Buffer.from(req.query.data, 'base64').toString('utf8') : null;
      if (!raw) return res.status(400).json({ error: 'data required (base64 JSON)' });
      const d = JSON.parse(raw);
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        d.feedback_id ?? null,
        d.title,
        d.summary,
        d.category ?? 'feature',
        d.risk ?? 'medium',
        d.source ?? `daily-run-2026-06-03`,
        d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json({ action, created });
    }

    return res.status(400).json({
      error: 'unknown action',
      available: ['get-proposals', 'patch-proposal', 'get-feedback', 'patch-feedback', 'post-message', 'post-proposal'],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
