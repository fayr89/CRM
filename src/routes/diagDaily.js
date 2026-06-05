// TEMP diag endpoint for AI daily run 2026-06-05-v36. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v36-9nRk2wXq';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=...&op=get-proposals|get-feedback
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const op = req.query.op;

    if (op === 'get-proposals') {
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status IN ('approved','revision','rejected')
         ORDER BY p.created_at DESC`,
      );
      return res.json({ ok: true, data: rows });
    }

    if (op === 'get-feedback') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      if (feedbacks.length > 0) {
        const ids = feedbacks.map((f) => f.id);
        const ph = ids.map(() => '?').join(',');
        const msgs = await db.all(
          `SELECT id, feedback_id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id IN (${ph}) ORDER BY created_at ASC, id ASC`,
          ...ids,
        );
        const byFb = {};
        for (const m of msgs) {
          if (!byFb[m.feedback_id]) byFb[m.feedback_id] = [];
          byFb[m.feedback_id].push(m);
        }
        for (const fb of feedbacks) fb.messages = byFb[fb.id] || [];
      }
      return res.json({ ok: true, data: feedbacks });
    }

    res.status(400).json({ error: 'op must be get-proposals or get-feedback' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily?secret=...
// body: { op, ...fields }
router.post('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op, ...d } = req.body || {};
    const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = admin?.id ?? null;

    if (op === 'patch-proposal') {
      if (!d.id || !d.decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status=?, admin_notes=?, admin_decision_by=?,
         admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
        d.decision, d.notes ?? null, adminId, Number(d.id),
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal') {
      if (!d.title || !d.summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        d.feedback_id ? Number(d.feedback_id) : null,
        d.title,
        d.summary,
        d.category ?? null,
        d.risk ?? 'medium',
        d.source ?? null,
        d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      if (!d.id || !d.status) return res.status(400).json({ error: 'id and status required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id=?', Number(d.id));
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = d.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply),
         resolved_by=COALESCE(?, resolved_by),
         resolved_at=${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at=NOW() WHERE id=?`,
        newStatus,
        d.admin_reply ?? null,
        justResolved ? adminId : null,
        Number(d.id),
      );
      return res.json({ ok: true });
    }

    if (op === 'post-message') {
      if (!d.feedback_id || !d.text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(d.feedback_id), adminId, d.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: `unknown op: ${op}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
