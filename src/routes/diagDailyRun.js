// TEMP: daily-run diag endpoint for AI (2026-06-08-v32). Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7e3a9c1f4b8d2e6a7e3a9c1f4b8d2e6a';

function auth(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// /proposals?token=S&status=approved|revision|rejected|pending
router.get('/proposals', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const status = req.query.status || null;
  const rows = await db.all(
    `SELECT p.id, p.title, p.summary, p.category, p.risk, p.status, p.source,
            p.feedback_id, p.admin_notes, p.proposed_changes,
            p.created_at, p.updated_at, p.admin_decision_at
     FROM ai_proposals p
     ${status ? 'WHERE p.status = ?' : ''}
     ORDER BY p.created_at DESC LIMIT 50`,
    ...(status ? [status] : []),
  );
  const withThreads = await Promise.all(rows.map(async (p) => {
    const msgs = await db.all(
      `SELECT id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC LIMIT 20`,
      p.id,
    );
    return { ...p, thread: msgs };
  }));
  res.json({ data: withThreads, count: withThreads.length });
}));

// /feedback?token=S&status=open|awaiting_approval (default: both)
router.get('/feedback', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const status = req.query.status || null;
  const rows = await db.all(
    `SELECT f.id, f.category, f.subject,
            SUBSTRING(f.message, 1, 800) AS message,
            f.status, f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     ${status ? 'WHERE f.status = ?' : "WHERE f.status IN ('open','awaiting_approval')"}
     ORDER BY f.created_at DESC LIMIT 80`,
    ...(status ? [status] : []),
  );
  const withThreads = await Promise.all(rows.map(async (fb) => {
    const msgs = await db.all(
      `SELECT id, user_name, role, SUBSTRING(text, 1, 600) AS text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC LIMIT 15`,
      fb.id,
    );
    return { ...fb, thread: msgs };
  }));
  res.json({ data: withThreads, count: withThreads.length });
}));

// /write?token=S&action=...  (GET-based writes, Vercel MCP is GET-only)
router.get('/write', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { action } = req.query;

  if (action === 'proposal-done') {
    const id = Number(req.query.id);
    if (!id) return res.json({ error: 'id required' });
    await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id);
    return res.json({ ok: true, id, action: 'done' });
  }

  if (action === 'proposal-revision-pending') {
    const id = Number(req.query.id);
    const summary = String(req.query.summary || '').slice(0, 5000);
    if (!id || !summary) return res.json({ error: 'id and summary required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'pending', summary = ?, updated_at = NOW() WHERE id = ?`,
      summary, id,
    );
    return res.json({ ok: true, id, action: 'revision-pending' });
  }

  if (action === 'proposal-msg') {
    const id = Number(req.query.id);
    const text = String(req.query.text || '').slice(0, 5000);
    if (!id || !text) return res.json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  if (action === 'proposal-create') {
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const title = String(req.query.title || '').slice(0, 200);
    const summary = String(req.query.summary || '').slice(0, 5000);
    const category = String(req.query.category || 'feature').slice(0, 60);
    const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
    const source = String(req.query.source || `daily-run-${new Date().toISOString().slice(0, 10)}`).slice(0, 60);
    if (!title || !summary) return res.json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedback_id, title, summary, category, risk, source,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'feedback-update') {
    const id = Number(req.query.id);
    const status = req.query.status || null;
    const admin_reply = req.query.admin_reply ? String(req.query.admin_reply).slice(0, 5000) : null;
    if (!id) return res.json({ error: 'id required' });
    if (!status && !admin_reply) return res.json({ error: 'nothing to update' });
    if (status) {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply, id,
      );
    } else {
      await db.run(`UPDATE feedback SET admin_reply = ?, updated_at = NOW() WHERE id = ?`, admin_reply, id);
    }
    return res.json({ ok: true, id, status, admin_reply });
  }

  if (action === 'feedback-msg') {
    const id = Number(req.query.id);
    const text = String(req.query.text || '').slice(0, 5000);
    if (!id || !text) return res.json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  res.json({
    error: 'unknown action',
    known: ['proposal-done', 'proposal-revision-pending', 'proposal-msg', 'proposal-create', 'feedback-update', 'feedback-msg'],
  });
}));

export default router;
