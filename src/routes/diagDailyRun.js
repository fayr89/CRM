// TEMP: ежедневный AI-обход обращений и ai_proposals. Удалить после обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'drun20260609v48x7';

function checkSecret(req, res) {
  if (req.query.token !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?token=X
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

    const proposalIds = proposals.map((p) => p.id);
    const proposalMessages = proposalIds.length
      ? await db.all(
          `SELECT proposal_id, id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[])
           ORDER BY created_at ASC, id ASC`,
          `{${proposalIds.join(',')}}`,
        )
      : [];
    const pmByProposal = {};
    for (const m of proposalMessages) {
      (pmByProposal[m.proposal_id] ||= []).push(m);
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at ASC`,
    );

    const fbIds = feedbacks.map((f) => f.id);
    const fbMessages = fbIds.length
      ? await db.all(
          `SELECT feedback_id, id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ANY(?::int[])
           ORDER BY created_at ASC, id ASC`,
          `{${fbIds.join(',')}}`,
        )
      : [];
    const fmByFeedback = {};
    for (const m of fbMessages) {
      (fmByFeedback[m.feedback_id] ||= []).push(m);
    }

    res.json({
      proposals: proposals.map((p) => ({ ...p, messages: pmByProposal[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: fmByFeedback[f.id] || [] })),
    });
  }),
);

// POST /api/diag/daily-run/feedback/:id/message?token=X
router.post(
  '/feedback/:id/message',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { text, user_name } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, ?, 'admin', ?)`,
      Number(req.params.id),
      user_name || 'AI ассистент',
      text,
    );
    res.json({ ok: true });
  }),
);

// PATCH /api/diag/daily-run/feedback/:id?token=X
router.patch(
  '/feedback/:id',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { status, admin_reply } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status required' });
    await db.run(
      `UPDATE feedback SET status = ?,
        admin_reply = COALESCE(?, admin_reply),
        resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
        updated_at = NOW()
       WHERE id = ?`,
      status,
      admin_reply ?? null,
      status,
      Number(req.params.id),
    );
    res.json({ ok: true });
  }),
);

// POST /api/diag/daily-run/proposals?token=X
router.post(
  '/proposals',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null,
      title,
      summary,
      category ?? null,
      risk || 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);

// PATCH /api/diag/daily-run/proposals/:id?token=X
router.patch(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { decision, notes } = req.body || {};
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
       admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision,
      notes ?? null,
      Number(req.params.id),
    );
    res.json({ ok: true });
  }),
);

// POST /api/diag/daily-run/proposals/:id/message?token=X
router.post(
  '/proposals/:id/message',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { text, user_name } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, ?, 'admin', ?)`,
      Number(req.params.id),
      user_name || 'AI ассистент',
      text,
    );
    res.json({ ok: true });
  }),
);

export default router;
