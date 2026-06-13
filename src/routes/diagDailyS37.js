// TEMP — ежедневный диаг daily-run 2026-06-13-s37 (снести после использования)
// GET /api/diag/daily-s37?secret=s37-8p2xqr5 → читать все proposals + feedback
// GET /api/diag/daily-s37?secret=s37-8p2xqr5&action=... → write-операции

import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 's37-8p2xqr5';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const action = req.query.action;

  if (action === 'patch_proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    const notes = req.query.notes || null;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       updated_at = NOW() WHERE id = ?`,
      decision, notes, id,
    );
    return res.json({ ok: true, id, decision });
  }

  if (action === 'post_proposal_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  if (action === 'create_proposal') {
    const title = req.query.title;
    const summary = req.query.summary;
    const category = req.query.category || 'feature';
    const risk = req.query.risk || 'medium';
    const source = req.query.source || 'daily-run-2026-06-13';
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const proposed_changes = req.query.proposed_changes || null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id, title, summary, category, risk, source,
      proposed_changes ? proposed_changes : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'patch_feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    const admin_reply = req.query.admin_reply || null;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       updated_at = NOW() WHERE id = ?`,
      status, admin_reply, id,
    );
    return res.json({ ok: true, id, status });
  }

  if (action === 'post_feedback_msg') {
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  // --- READ ALL ---
  const proposals = await db.all(
    `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
            p.feedback_id, p.admin_notes, p.proposed_changes,
            p.created_at, p.updated_at, p.admin_decision_at
     FROM ai_proposals p
     WHERE p.status IN ('approved','revision','rejected','pending')
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'pending' THEN 2 ELSE 3 END), p.created_at ASC`,
  );

  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
       WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    if (p.proposed_changes && typeof p.proposed_changes === 'string') {
      try { p.proposed_changes = JSON.parse(p.proposed_changes); } catch {}
    }
  }

  const feedback = await db.all(
    `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
            f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at ASC`,
  );

  for (const fb of feedback) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({
    proposals_approved: proposals.filter(p => p.status === 'approved'),
    proposals_revision: proposals.filter(p => p.status === 'revision'),
    proposals_rejected: proposals.filter(p => p.status === 'rejected'),
    proposals_pending: proposals.filter(p => p.status === 'pending'),
    feedback_open: feedback.filter(f => f.status === 'open'),
    feedback_awaiting: feedback.filter(f => f.status === 'awaiting_approval'),
    retrieved_at: new Date().toISOString(),
  });
}));

export default router;
