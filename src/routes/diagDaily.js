// TEMP — ежедневный AI-обход 2026-06-19 m4k9p2. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DIAG_SECRET = 'm4k9p2r7x5b3';

router.use((req, res, next) => {
  if (req.query?.s === DIAG_SECRET) return next();
  return res.status(403).json({ error: 'forbidden' });
});

// GET /all — читаем всё нужное для обхода
router.get(
  '/all',
  asyncHandler(async (_req, res) => {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.status AS feedback_status,
              f.user_id AS feedback_user_id, fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY proposal_id, created_at ASC`,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    const feedbackIds = feedbacks.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY feedback_id, created_at ASC`,
      );
    }

    const msgByProposal = {};
    for (const m of proposalMessages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }

    res.json({
      proposals: proposals.map((p) => ({ ...p, messages: msgByProposal[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: msgByFeedback[f.id] || [] })),
    });
  }),
);

// POST /write — мутации (сообщения, статусы, новые proposals)
router.post(
  '/write',
  asyncHandler(async (req, res) => {
    const { op, ...data } = req.body || {};

    if (op === 'proposal_done') {
      // PATCH ai_proposals/:id { decision: 'done' }
      const { id } = data;
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        id,
      );
      return res.json({ ok: true, op, id });
    }

    if (op === 'proposal_create') {
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      return res.status(201).json({ ok: true, op, id: r.lastInsertRowid });
    }

    if (op === 'proposal_msg') {
      // POST /api/ai-proposals/:id/messages
      const { proposal_id, text } = data;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id,
        text,
      );
      return res.status(201).json({ ok: true, op, id: r.lastInsertRowid });
    }

    if (op === 'feedback_status') {
      // PATCH /api/feedback/:id
      const { id, status, admin_reply } = data;
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW()
         WHERE id = ?`,
        status,
        admin_reply ?? null,
        id,
      );
      return res.json({ ok: true, op, id, status });
    }

    if (op === 'feedback_msg') {
      // POST /api/feedback/:id/messages от AI ассистент
      const { feedback_id, text } = data;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id,
        text,
      );
      return res.status(201).json({ ok: true, op, id: r.lastInsertRowid });
    }

    if (op === 'feedback_close') {
      const { id, msg } = data;
      await db.run(
        `UPDATE feedback SET status = 'closed', updated_at = NOW() WHERE id = ?`,
        id,
      );
      if (msg) {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
          id,
          msg,
        );
      }
      return res.json({ ok: true, op, id });
    }

    return res.status(400).json({ error: 'unknown op', op });
  }),
);

export default router;
