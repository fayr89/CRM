// TEMP: ежедневный обход AI — одноразовый диагностический эндпоинт.
// Снести немедленно после использования. Все операции через GET (Vercel MCP не поддерживает POST).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr42-k7mq-9vzn';

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET ?s=SECRET&what=all → proposals (все кроме done) + feedback (open/awaiting) с тредами
router.get('/', asyncHandler(async (req, res) => {
  const what = req.query.what || 'all';

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     WHERE p.status != 'done'
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
              p.created_at DESC
     LIMIT 100`,
  );
  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  if (what === 'proposals') return res.json({ proposals });

  const feedbacks = await db.all(
    `SELECT f.id, f.status, f.category, f.subject, f.message,
            f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.updated_at DESC NULLS LAST
     LIMIT 100`,
  );
  const ids = feedbacks.map((r) => r.id);
  let threads = [];
  if (ids.length) {
    threads = await db.all(
      `SELECT feedback_id, id, user_name, role, text, created_at
       FROM feedback_messages
       WHERE feedback_id = ANY(?::int[])
       ORDER BY created_at ASC, id ASC`,
      `{${ids.join(',')}}`,
    );
  }
  const byFeedback = {};
  for (const m of threads) {
    if (!byFeedback[m.feedback_id]) byFeedback[m.feedback_id] = [];
    byFeedback[m.feedback_id].push(m);
  }
  const feedbacksWithThreads = feedbacks.map((f) => ({ ...f, thread: byFeedback[f.id] || [] }));

  return res.json({ proposals, feedbacks: feedbacksWithThreads });
}));

// Write-действия через GET (Vercel MCP поддерживает только GET):
// ?s=SECRET&action=proposal_done&id=N
// ?s=SECRET&action=proposal_create&title=T&summary=S&category=C&risk=R&source=SRC&feedback_id=N&proposed_changes=JSON
// ?s=SECRET&action=proposal_revision&id=N&title=T&summary=S&category=C&risk=R&proposed_changes=JSON
// ?s=SECRET&action=proposal_message&id=N&text=T
// ?s=SECRET&action=feedback_status&fid=N&status=S&reply=R
// ?s=SECRET&action=feedback_msg&fid=N&text=T
// ?s=SECRET&action=feedback_close_rejected&fid=N&proposal_title=T
router.get('/write', asyncHandler(async (req, res) => {
  const { action, id, fid, text, status, reply,
    title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;

  if (action === 'proposal_done') {
    const pid = Number(id);
    if (!pid) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
      pid,
    );
    return res.json({ ok: true, action, id: pid });
  }

  if (action === 'proposal_create') {
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    let changesJson = null;
    if (proposed_changes) {
      try { changesJson = JSON.stringify(JSON.parse(proposed_changes)); } catch { changesJson = null; }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      String(title),
      String(summary),
      category ? String(category) : null,
      risk || 'medium',
      source ? String(source) : null,
      changesJson,
    );
    return res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'proposal_revision') {
    const pid = Number(id);
    if (!pid) return res.status(400).json({ error: 'id required' });
    let changesJson = null;
    if (proposed_changes) {
      try { changesJson = JSON.stringify(JSON.parse(proposed_changes)); } catch { changesJson = null; }
    }
    const updates = [];
    const vals = [];
    if (title) { updates.push('title = ?'); vals.push(String(title)); }
    if (summary) { updates.push('summary = ?'); vals.push(String(summary)); }
    if (category) { updates.push('category = ?'); vals.push(String(category)); }
    if (risk) { updates.push('risk = ?'); vals.push(String(risk)); }
    if (changesJson) { updates.push('proposed_changes = ?::jsonb'); vals.push(changesJson); }
    updates.push('status = ?'); vals.push('pending');
    updates.push('updated_at = NOW()');
    vals.push(pid);
    await db.run(`UPDATE ai_proposals SET ${updates.join(', ')} WHERE id = ?`, ...vals);
    return res.json({ ok: true, action, id: pid });
  }

  if (action === 'proposal_message') {
    const pid = Number(id);
    if (!pid || !text) return res.status(400).json({ error: 'id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
      pid,
      String(text),
    );
    return res.json({ ok: true, action, id: pid });
  }

  if (action === 'feedback_status') {
    const feedbackId = Number(fid);
    if (!feedbackId || !status) return res.status(400).json({ error: 'fid and status required' });
    await db.run(
      `UPDATE feedback SET status = ?,
       admin_reply = COALESCE(?, admin_reply),
       updated_at = NOW() WHERE id = ?`,
      String(status),
      reply ? String(reply) : null,
      feedbackId,
    );
    return res.json({ ok: true, action, fid: feedbackId, status });
  }

  if (action === 'feedback_msg') {
    const feedbackId = Number(fid);
    if (!feedbackId || !text) return res.status(400).json({ error: 'fid and text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
      feedbackId,
      String(text),
    );
    return res.json({ ok: true, action, fid: feedbackId });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
