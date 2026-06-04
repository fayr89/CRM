// TEMP: ежедневный AI-обход 2026-06-04-v5. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'd2026-06-04-v5-mK3r';
const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });

  const op = req.query.op || 'list-feedback';

  if (op === 'list-proposals') {
    const status = req.query.status || 'pending';
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status = ?
       ORDER BY p.created_at DESC`,
      status,
    );
    return res.json({ data: rows });
  }

  if (op === 'list-feedback') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at ASC`,
    );
    const ids = rows.map(r => r.id);
    let messages = [];
    if (ids.length > 0) {
      messages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${ids.map(() => '?').join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
        ...ids,
      );
    }
    const byFeedback = {};
    for (const m of messages) byFeedback[m.feedback_id] = [...(byFeedback[m.feedback_id] || []), m];
    const result = rows.map(r => ({ ...r, messages: byFeedback[r.id] || [] }));
    return res.json({ data: result });
  }

  if (op === 'post-proposal') {
    const body = req.body || {};
    const { title, summary, category, risk, source, proposed_changes, feedback_id } = body;
    const row = await db.get(
      `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING *`,
      title, summary, category || 'feature', risk || 'low',
      source || 'daily-run-2026-06-04', JSON.stringify(proposed_changes || []),
      feedback_id || null,
    );
    return res.json({ data: row });
  }

  if (op === 'patch-proposal') {
    const { id, decision, summary, status } = req.body || {};
    if (decision === 'done') {
      await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id);
    } else if (status) {
      await db.run(`UPDATE ai_proposals SET status=?, updated_at=NOW() WHERE id=?`, status, id);
    } else if (summary) {
      await db.run(`UPDATE ai_proposals SET summary=?, status='pending', updated_at=NOW() WHERE id=?`, summary, id);
    }
    return res.json({ ok: true });
  }

  if (op === 'patch-feedback') {
    const { id, status, admin_reply } = req.body || {};
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), updated_at=NOW() WHERE id=?`,
      status, admin_reply || null, id,
    );
    return res.json({ ok: true });
  }

  if (op === 'post-message') {
    const { feedback_id, text, user_name } = req.body || {};
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
       VALUES (?, ?, 'admin', ?)`,
      feedback_id, user_name || 'AI ассистент', text,
    );
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'unknown op' });
}));

export default router;
