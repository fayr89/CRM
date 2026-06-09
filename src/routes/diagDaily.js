// TEMP: AI ежедневный обход — диагностический эндпоинт. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'b9e2f7a3d1c4e6f0b8d3a7c2e5f9b1d4';

const chk = (req, res, next) => {
  if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
  next();
};

// GET /api/diag-daily/proposals?token=X&status=approved|revision|rejected|pending
router.get('/proposals', chk, asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? await db.all(
        `SELECT id, title, summary, category, risk, status, feedback_id,
                proposed_changes, admin_notes, source, created_at, updated_at
         FROM ai_proposals WHERE status = ? ORDER BY created_at DESC LIMIT 100`,
        status,
      )
    : await db.all(
        `SELECT id, title, summary, category, risk, status, feedback_id,
                proposed_changes, admin_notes, source, created_at, updated_at
         FROM ai_proposals ORDER BY created_at DESC LIMIT 100`,
      );
  res.json({ count: rows.length, rows });
}));

// GET /api/diag-daily/proposal-messages?token=X&id=Y
router.get('/proposal-messages', chk, asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const rows = await db.all(
    `SELECT id, proposal_id, user_name, role, text, created_at
     FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
    id,
  );
  res.json({ count: rows.length, rows });
}));

// GET /api/diag-daily/feedback?token=X  — открытые + awaiting_approval с тредами
router.get('/feedback', chk, asyncHandler(async (req, res) => {
  const feedbacks = await db.all(
    `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
            f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at ASC`,
  );
  const result = [];
  for (const fb of feedbacks) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    result.push({ ...fb, thread: msgs });
  }
  res.json({ count: result.length, feedbacks: result });
}));

// GET /api/diag-daily/patch-proposal?token=X&id=Y&decision=done
router.get('/patch-proposal', chk, asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  const decision = req.query.decision ? String(req.query.decision) : null;
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
  if (!['done', 'approved', 'rejected', 'revision', 'pending'].includes(decision)) {
    return res.status(400).json({ error: 'invalid decision' });
  }
  await db.run(
    `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
    decision, id,
  );
  res.json({ ok: true, id, decision });
}));

// GET /api/diag-daily/add-fb-msg?token=X&feedback_id=Y&text=URLENCODED
router.get('/add-fb-msg', chk, asyncHandler(async (req, res) => {
  const feedback_id = Number(req.query.feedback_id);
  const text = req.query.text ? String(req.query.text) : null;
  if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
  const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
  if (!fb) return res.status(404).json({ error: 'feedback not found' });
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    feedback_id, text,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// GET /api/diag-daily/patch-feedback?token=X&id=Y&status=Z&admin_reply=URLENCODED
router.get('/patch-feedback', chk, asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  const status = req.query.status ? String(req.query.status) : null;
  const admin_reply = req.query.admin_reply ? String(req.query.admin_reply) : null;
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  if (!['open', 'closed', 'awaiting_approval', 'in_progress'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  if (admin_reply) {
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
      status, admin_reply, id,
    );
  } else {
    await db.run(
      `UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, id,
    );
  }
  res.json({ ok: true, id, status });
}));

// GET /api/diag-daily/create-proposal?token=X&title=...&summary=...&category=...&risk=...&feedback_id=N&source=...&changes=JSON
router.get('/create-proposal', chk, asyncHandler(async (req, res) => {
  const title = req.query.title ? String(req.query.title).trim() : null;
  const summary = req.query.summary ? String(req.query.summary) : null;
  const category = req.query.category ? String(req.query.category) : 'feature';
  const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
  const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
  const source = req.query.source || `daily-run-${new Date().toISOString().slice(0, 10)}`;
  const proposed_changes = req.query.changes
    ? (() => { try { return JSON.parse(String(req.query.changes)); } catch { return []; } })()
    : [];
  if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
  const r = await db.run(
    `INSERT INTO ai_proposals
     (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary, category, risk, source,
    proposed_changes.length ? JSON.stringify(proposed_changes) : null,
  );
  res.json({ ok: true, id: r.lastInsertRowid, title });
}));

// GET /api/diag-daily/add-proposal-msg?token=X&proposal_id=Y&text=URLENCODED
router.get('/add-proposal-msg', chk, asyncHandler(async (req, res) => {
  const proposal_id = Number(req.query.proposal_id);
  const text = req.query.text ? String(req.query.text) : null;
  if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
  const p = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposal_id);
  if (!p) return res.status(404).json({ error: 'proposal not found' });
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    proposal_id, text,
  );
  res.json({ ok: true, id: r.lastInsertRowid });
}));

export default router;
