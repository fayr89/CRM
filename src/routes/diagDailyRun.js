// TEMP: Daily-run diag для AI-ассистента (2026-06-09-v56). Снести после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr56-4a9f2e8b5c1d7e3f';

function check(req, res) {
  if (req.query.secret !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /all — весь контекст для обхода: proposals + feedback с тредами
router.get('/all', asyncHandler(async (req, res) => {
  if (!check(req, res)) return;

  const proposals = await db.all(`
    SELECT p.id, p.feedback_id, p.title, p.summary, p.category, p.risk, p.source,
           p.status, p.admin_notes, p.admin_decision_at, p.created_at, p.updated_at,
           u.name AS admin_decision_by_name,
           f.subject AS feedback_subject
    FROM ai_proposals p
    LEFT JOIN users u ON u.id = p.admin_decision_by
    LEFT JOIN feedback f ON f.id = p.feedback_id
    ORDER BY p.created_at DESC
    LIMIT 100
  `);

  const propMsgs = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    if (msgs.length) propMsgs[p.id] = msgs;
  }

  const feedbacks = await db.all(`
    SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
           f.created_at, f.updated_at,
           u.name AS user_name, u.email AS user_email, u.role AS user_role
    FROM feedback f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
    ORDER BY
      (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
      f.created_at DESC
    LIMIT 100
  `);

  const fbMsgs = {};
  for (const fb of feedbacks) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    fbMsgs[fb.id] = msgs;
  }

  res.json({
    proposals,
    proposal_messages: propMsgs,
    feedbacks,
    feedback_messages: fbMsgs,
    ts: new Date().toISOString(),
  });
}));

// GET /cmd — мутации через query-параметры (GET-only диаг)
router.get('/cmd', asyncHandler(async (req, res) => {
  if (!check(req, res)) return;
  const { action } = req.query;

  if (action === 'patch_proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    if (!id || !decision) return res.status(400).json({ error: 'id+decision required' });
    await db.run(`UPDATE ai_proposals SET status=?, updated_at=NOW() WHERE id=?`, decision, id);
    return res.json({ ok: true, id, status: decision });
  }

  if (action === 'post_proposal') {
    const { feedback_id, title, summary, category, risk, source } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title+summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title,
      summary,
      category || null,
      risk || 'medium',
      source || 'daily-run-2026-06-09',
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'post_proposal_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id+text required' });
    const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
      id,
      admin?.id || null,
      text,
    );
    return res.json({ ok: true });
  }

  if (action === 'update_feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    const admin_reply = req.query.admin_reply || null;
    if (!id || !status) return res.status(400).json({ error: 'id+status required' });
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), updated_at=NOW() WHERE id=?`,
      status,
      admin_reply,
      id,
    );
    return res.json({ ok: true, id, status });
  }

  if (action === 'post_feedback_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id+text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id=?', id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
      id,
      admin?.id || null,
      text,
    );
    return res.json({ ok: true, id });
  }

  if (action === 'close_feedback') {
    const id = Number(req.query.id);
    const note = req.query.note || null;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE feedback SET status='closed',
       admin_reply=COALESCE(?, admin_reply),
       resolved_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      note,
      id,
    );
    return res.json({ ok: true, id, status: 'closed' });
  }

  return res.status(400).json({ error: `unknown action: ${action}` });
}));

export default router;
