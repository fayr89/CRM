// TEMP — временный диаг-эндпоинт для ежедневного AI-обхода (второй запуск 2026-06-12).
// Сносится сразу после использования.
// GET /api/diag/daily-s2?s=DAILY_RUN_2026_06_12_S2_K9pQ[&act=...&params]
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'DAILY_RUN_2026_06_12_S2_K9pQ';

function guard(req, res) {
  if (req.query.s !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

router.get('/daily-s2', async (req, res) => {
  if (!guard(req, res)) return;
  const { act } = req.query;

  try {
    // ── WRITE ACTIONS ──────────────────────────────────────────────────────
    if (act === 'proposal_done') {
      const { id } = req.query;
      await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id);
      return res.json({ ok: true, action: 'proposal_done', id });
    }

    if (act === 'proposal_revision_to_pending') {
      const { id, summary, proposed_changes } = req.query;
      const updates = [];
      const vals = [];
      if (summary) { updates.push('summary=?'); vals.push(summary); }
      if (proposed_changes) { updates.push('proposed_changes=?'); vals.push(proposed_changes); }
      updates.push("status='pending'", 'updated_at=NOW()');
      vals.push(id);
      await db.run(`UPDATE ai_proposals SET ${updates.join(',')} WHERE id=?`, ...vals);
      return res.json({ ok: true, action: 'proposal_revision_to_pending', id });
    }

    if (act === 'proposal_create') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'pending',NOW(),NOW()) RETURNING id`,
        title, summary, category || 'feature', risk || 'medium',
        source || 'daily-run-2026-06-12-s2',
        feedback_id || null,
        proposed_changes || '[]',
      );
      return res.json({ ok: true, action: 'proposal_create', id: r.lastInsertRowid });
    }

    if (act === 'proposal_msg') {
      const { id, text } = req.query;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
         VALUES (?,?,?,?,NOW())`,
        id, 'AI ассистент', 'admin', decodeURIComponent(text),
      );
      return res.json({ ok: true, action: 'proposal_msg', id });
    }

    if (act === 'feedback_msg') {
      const { id, text } = req.query;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?,NULL,?,?,?)`,
        id, 'AI ассистент', 'admin', decodeURIComponent(text),
      );
      return res.json({ ok: true, action: 'feedback_msg', id });
    }

    if (act === 'feedback_awaiting') {
      const { id, reply } = req.query;
      await db.run(
        `UPDATE feedback SET status='awaiting_approval', admin_reply=?, updated_at=NOW() WHERE id=?`,
        decodeURIComponent(reply || ''), id,
      );
      return res.json({ ok: true, action: 'feedback_awaiting', id });
    }

    if (act === 'feedback_close') {
      const { id, reply } = req.query;
      await db.run(
        `UPDATE feedback SET status='closed', admin_reply=?, updated_at=NOW() WHERE id=?`,
        decodeURIComponent(reply || ''), id,
      );
      return res.json({ ok: true, action: 'feedback_close', id });
    }

    // ── READ (default) ─────────────────────────────────────────────────────
    const proposals = await db.all(
      `SELECT id, title, summary, category, risk, source, status, admin_notes,
              feedback_id, proposed_changes, created_at, updated_at
       FROM ai_proposals WHERE status != 'done'
       ORDER BY created_at DESC`,
    );

    const proposalMessages = {};
    for (const p of proposals) {
      proposalMessages[p.id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC`,
        p.id,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.id, u.name AS user_name, u.email,
              f.category, f.subject, f.message,
              f.status, f.admin_reply, f.created_at, f.updated_at
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const feedbackMessages = {};
    for (const f of feedbacks) {
      feedbackMessages[f.id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC`,
        f.id,
      );
    }

    return res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
