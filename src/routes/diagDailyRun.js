// TEMP: ежедневный AI-обход обращений и ai_proposals. Удалить после обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'drun20260609v49z3';

function checkSecret(req, res) {
  if (req.query.token !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?token=X  — читает все данные
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
      `SELECT f.*, u.name AS user_display, u.email AS user_email, u.role AS user_role
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

// GET /api/diag/daily-run/write?token=X&op=...  — все записи через GET
router.get(
  '/write',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { op } = req.query;

    if (op === 'post_fb_message') {
      const fbId = Number(req.query.feedback_id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      const userName = req.query.user_name ? decodeURIComponent(req.query.user_name) : 'AI ассистент';
      if (!fbId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        fbId, userName, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'patch_feedback') {
      const fbId = Number(req.query.feedback_id);
      const status = req.query.status;
      const adminReply = req.query.admin_reply ? decodeURIComponent(req.query.admin_reply) : null;
      if (!fbId || !status) return res.status(400).json({ error: 'feedback_id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?,
          admin_reply = COALESCE(?, admin_reply),
          resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
          updated_at = NOW()
         WHERE id = ?`,
        status, adminReply, status, fbId,
      );
      return res.json({ ok: true });
    }

    if (op === 'post_proposal') {
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const title = req.query.title ? decodeURIComponent(req.query.title) : null;
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : null;
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source ? decodeURIComponent(req.query.source) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch_proposal') {
      const propId = Number(req.query.proposal_id);
      const decision = req.query.decision;
      const notes = req.query.notes ? decodeURIComponent(req.query.notes) : null;
      if (!propId || !decision) return res.status(400).json({ error: 'proposal_id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes, propId,
      );
      return res.json({ ok: true });
    }

    if (op === 'post_proposal_message') {
      const propId = Number(req.query.proposal_id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      const userName = req.query.user_name ? decodeURIComponent(req.query.user_name) : 'AI ассистент';
      if (!propId || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        propId, userName, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown op', valid_ops: ['post_fb_message','patch_feedback','post_proposal','patch_proposal','post_proposal_message'] });
  }),
);

export default router;
