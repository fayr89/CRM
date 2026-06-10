// TEMPORARY: daily AI run endpoint. DELETE AFTER USE (commit separately).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-10-x7k2';

function auth(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get('/', async (req, res) => {
  if (!auth(req, res)) return;
  const { op } = req.query;
  try {
    // ── READ ──────────────────────────────────────────────────────────────────

    if (op === 'get-proposals') {
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC LIMIT 50`,
        req.query.status || 'pending',
      );
      const result = [];
      for (const row of rows) {
        const msgs = await db.all(
          'SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC',
          row.id,
        );
        result.push({ ...row, messages: msgs });
      }
      return res.json({ data: result });
    }

    if (op === 'get-feedback') {
      const rows = await db.all(
        `SELECT f.*, u.name AS author_name, u.email AS author_email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC LIMIT 100`,
      );
      const result = [];
      for (const row of rows) {
        const msgs = await db.all(
          'SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC',
          row.id,
        );
        result.push({ ...row, messages: msgs });
      }
      return res.json({ data: result });
    }

    // ── WRITE ─────────────────────────────────────────────────────────────────

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'update-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply || null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply, id,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
         VALUES (?, 'AI ассистент', 'admin', ?, NOW())`,
        feedback_id, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal') {
      const { title, summary, category, risk, source, feedback_id } = req.query;
      const proposed_changes = req.query.proposed_changes
        ? JSON.parse(req.query.proposed_changes)
        : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const row = await db.get(
        `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())
         RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary,
        category || null,
        risk || 'medium',
        source || null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: row.id });
    }

    if (op === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
         VALUES (?, 'AI ассистент', 'admin', ?, NOW())`,
        id, text,
      );
      return res.json({ ok: true });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
