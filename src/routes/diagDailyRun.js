// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода.
// Удалить сразу после использования отдельным коммитом.
// Секрет одноразовый, жёстко вшит в код — не persist.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr9f2m7v1k4';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET — весь контекст для обхода: proposals + feedback с тредами
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
    );

    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT proposal_id, id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        JSON.stringify(proposalIds),
      );
    }

    const feedbackRows = await db.all(
      `SELECT f.id, f.status, f.subject, f.message, f.category, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at ASC`,
    );

    const feedbackIds = feedbackRows.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT feedback_id, id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        JSON.stringify(feedbackIds),
      );
    }

    const pmByProposal = {};
    for (const m of proposalMessages) {
      (pmByProposal[m.proposal_id] ||= []).push(m);
    }
    const fmByFeedback = {};
    for (const m of feedbackMessages) {
      (fmByFeedback[m.feedback_id] ||= []).push(m);
    }

    res.json({
      proposals: proposals.map((p) => ({ ...p, messages: pmByProposal[p.id] || [] })),
      feedback: feedbackRows.map((f) => ({ ...f, messages: fmByFeedback[f.id] || [] })),
    });
  }),
);

// POST — мутации: proposal.patch | proposal.create | proposal.message |
//                 feedback.update | feedback.message
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { op, id } = req.body || {};

    if (op === 'proposal.patch') {
      const { status, notes } = req.body;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        status, notes ?? null, id,
      );
      return res.json({ ok: true });
    }

    if (op === 'proposal.create') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary,
        category ?? null, risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    if (op === 'proposal.message') {
      const { text } = req.body;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 1, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'feedback.update') {
      const { status, admin_reply } = req.body;
      const cur = await db.get('SELECT status FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const justResolved = (status === 'awaiting_approval' || status === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      if (justResolved) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
          status, admin_reply ?? null, id,
        );
      } else {
        await db.run(
          `UPDATE feedback SET status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
          status ?? null, admin_reply ?? null, id,
        );
      }
      return res.json({ ok: true });
    }

    if (op === 'feedback.message') {
      const { text, feedback_id } = req.body;
      const fid = feedback_id ?? id;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 1, 'AI ассистент', 'admin', ?)`,
        fid, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
