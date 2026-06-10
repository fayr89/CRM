// TEMP — ежедневный обход AI. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-10-x7k9mpq3';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=...&action=list-proposals[&status=approved]
// GET /api/diag/daily?secret=...&action=list-feedback
// GET /api/diag/daily?secret=...&action=proposal-messages&id=N
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { action } = req.query;

    if (action === 'list-proposals') {
      const where = req.query.status ? 'WHERE status = $1' : '';
      const params = req.query.status ? [req.query.status] : [];
      const rows = await db.all(
        `SELECT * FROM ai_proposals ${where} ORDER BY created_at DESC LIMIT 100`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (action === 'list-feedback') {
      const items = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.updated_at DESC LIMIT 100`,
      );
      const result = [];
      for (const fb of items) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    if (action === 'proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily?secret=...
// body: { action, ...payload }
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { action, ...payload } = req.body || {};

    if (action === 'patch-proposal') {
      // { id, decision }
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        payload.decision,
        payload.id,
      );
      return res.json({ ok: true });
    }

    if (action === 'patch-feedback') {
      // { id, status, admin_reply }
      const sets = ['status = ?', 'updated_at = NOW()'];
      const params = [payload.status];
      if (payload.admin_reply !== undefined) {
        sets.push('admin_reply = ?');
        params.push(payload.admin_reply);
      }
      await db.run(
        `UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`,
        ...params,
        payload.id,
      );
      return res.json({ ok: true });
    }

    if (action === 'post-feedback-msg') {
      // { feedback_id, text, user_name }
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        payload.feedback_id,
        payload.user_name || 'AI ассистент',
        payload.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'create-proposal') {
      // { feedback_id?, title, summary, category, risk, source, proposed_changes? }
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        payload.feedback_id ?? null,
        payload.title,
        payload.summary,
        payload.category ?? null,
        payload.risk || 'medium',
        payload.source ?? null,
        payload.proposed_changes ? JSON.stringify(payload.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'post-proposal-msg') {
      // { proposal_id, text, user_name }
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        payload.proposal_id,
        payload.user_name || 'AI ассистент',
        payload.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
