// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода обращений.
// Удалить сразу после использования отдельным коммитом!
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'e5c2a9f1d4b7';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s === SECRET || req.body?.s === SECRET) {
    req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
    return next();
  }
  return res.status(403).json({ error: 'forbidden' });
});

// GET: все нужные данные одним запросом
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Proposals по статусам
    const proposalRows = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
    );

    // Треды proposal
    const proposalIds = proposalRows.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT id, proposal_id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }

    // Feedback (открытые + awaiting_approval)
    const feedbackRows = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at, f.user_id,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
    );

    // Треды feedback
    const feedbackIds = feedbackRows.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    // Группируем треды
    const pmByProposal = {};
    for (const m of proposalMessages) {
      (pmByProposal[m.proposal_id] = pmByProposal[m.proposal_id] || []).push(m);
    }
    const fmByFeedback = {};
    for (const m of feedbackMessages) {
      (fmByFeedback[m.feedback_id] = fmByFeedback[m.feedback_id] || []).push(m);
    }

    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      proposals[status] = proposalRows
        .filter((p) => p.status === status)
        .map((p) => ({ ...p, messages: pmByProposal[p.id] || [] }));
    }

    res.json({
      proposals,
      feedback: feedbackRows.map((f) => ({ ...f, messages: fmByFeedback[f.id] || [] })),
    });
  }),
);

// POST: действия
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { action } = req.body || {};

    if (action === 'create_proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null,
        title,
        summary,
        category ?? null,
        risk || 'medium',
        source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (action === 'patch_proposal') {
      const { id, decision, notes } = req.body;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?,
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        notes ?? null,
        id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (action === 'post_proposal_message') {
      const { proposal_id, text, user_name } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
        proposal_id,
        user_name || 'AI ассистент',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    if (action === 'post_feedback_message') {
      const { feedback_id, text, user_name } = req.body;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
        feedback_id,
        user_name || 'AI ассистент',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'patch_feedback') {
      const { id, status, admin_reply } = req.body;
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status ?? cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?,
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        newStatus,
        admin_reply ?? null,
        justResolved ? 0 : cur.resolved_by,
        id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
    }

    return res.status(400).json({ error: 'unknown action' });
  }),
);

export default router;
