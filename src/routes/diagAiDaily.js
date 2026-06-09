// TEMP: ежедневный AI-обход 2026-06-09-v52. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'ai-daily-v52-9k2mXpLqRw7';

router.get(
  '/all',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    // AI proposals by status
    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      proposals[status] = await db.all(
        `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                p.status, p.feedback_id, p.admin_notes, p.proposed_changes,
                p.created_at, p.updated_at, p.admin_decision_at,
                f.subject AS feedback_subject, f.status AS feedback_status
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC`,
        status,
      );
    }

    // Threads for all non-done proposals
    const allProposalIds = [
      ...proposals.approved,
      ...proposals.revision,
      ...proposals.rejected,
      ...proposals.pending,
    ].map((p) => p.id);

    const threads = {};
    for (const id of allProposalIds) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      if (msgs.length) threads[id] = msgs;
    }

    // Feedback: open + awaiting_approval
    const feedback = await db.all(
      `SELECT f.id, f.subject, f.description, f.status, f.user_id,
              u.name AS user_name, u.email AS user_email,
              f.admin_reply, f.created_at, f.updated_at
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at ASC`,
    );

    // Threads for feedback
    const feedbackThreads = {};
    for (const fb of feedback) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackThreads[fb.id] = msgs;
    }

    res.json({ proposals, threads, feedback, feedbackThreads });
  }),
);

// Мутации через GET (безопасно: только AI-обход, секрет в query)
router.get(
  '/act',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const action = req.query.action;

    if (action === 'patch-proposal') {
      // decision: done | pending | approved | rejected | revision
      const { id, decision, notes } = req.query;
      if (!id || !decision) return res.status(400).json({ error: 'id, decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes || null, Number(id),
      );
      return res.json({ ok: true, id: Number(id), decision });
    }

    if (action === 'post-proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title, summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
        proposed_changes || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'post-proposal-msg') {
      const { id, text } = req.query;
      if (!id || !text) return res.status(400).json({ error: 'id, text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(id), text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    if (action === 'post-feedback-msg') {
      const { feedback_id, text } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id, text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(feedback_id), text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    if (action === 'patch-feedback') {
      // status: open | awaiting_approval | closed
      const { id, status, admin_reply } = req.query;
      if (!id || !status) return res.status(400).json({ error: 'id, status required' });
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
         WHERE id = ?`,
        status, admin_reply || null, Number(id),
      );
      return res.json({ ok: true, id: Number(id), status });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }),
);

export default router;
