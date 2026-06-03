// TEMP: daily AI run diag endpoint — DELETE AFTER USE
// Session: EF487 / 2026-06-03-v4
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-EF487-2026-06-03-v4';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=X  — все open/awaiting_approval обращения с тредами + ai_proposals
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const ids = feedbacks.map(f => f.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT feedback_id, id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${ids.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }
    const msgByFb = {};
    for (const m of messages) {
      if (!msgByFb[m.feedback_id]) msgByFb[m.feedback_id] = [];
      msgByFb[m.feedback_id].push(m);
    }
    const result = feedbacks.map(f => ({ ...f, thread: msgByFb[f.id] || [] }));

    const proposals = await db.all(
      `SELECT id, status, title, summary, category, risk, source, feedback_id, admin_notes,
              proposed_changes, created_at
       FROM ai_proposals
       WHERE status IN ('approved','revision','rejected','pending')
       ORDER BY created_at DESC`,
    );

    res.json({ feedbacks: result, proposals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/write?secret=X&op=...
router.get('/write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { op } = req.query;
  try {
    if (op === 'post-message') {
      const { feedback_id, text } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        Number(feedback_id),
        decodeURIComponent(text),
      );
      return res.json({ ok: true, op });
    }

    if (op === 'update-feedback') {
      const { feedback_id, status, admin_reply } = req.query;
      if (!feedback_id) return res.status(400).json({ error: 'feedback_id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(feedback_id));
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        newStatus,
        admin_reply ? decodeURIComponent(admin_reply) : null,
        Number(feedback_id),
      );
      return res.json({ ok: true, op, id: Number(feedback_id), status: newStatus });
    }

    if (op === 'create-proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        decodeURIComponent(title),
        decodeURIComponent(summary),
        category || null,
        risk || 'medium',
        source || 'daily-run-2026-06-03-v4',
        proposed_changes ? decodeURIComponent(proposed_changes) : null,
      );
      return res.json({ ok: true, op, id: r.lastInsertRowid });
    }

    if (op === 'update-proposal') {
      const { proposal_id, decision } = req.query;
      if (!proposal_id || !decision) return res.status(400).json({ error: 'proposal_id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision,
        Number(proposal_id),
      );
      return res.json({ ok: true, op, id: Number(proposal_id), status: decision });
    }

    return res.status(400).json({ error: 'unknown op', ops: ['post-message','update-feedback','create-proposal','update-proposal'] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
