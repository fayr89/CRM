// TEMP: daily AI run 2026-06-09-v53. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'a3f7b2c9e1d4f6a8b3c7d2e9f1a4b6c8';

router.get(
  '/all',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    // AI proposals: approved, revision, rejected, pending
    const proposals = await db.all(
      `SELECT p.id, p.title, p.summary, p.category, p.risk, p.status,
              p.source, p.feedback_id, p.admin_notes, p.proposed_changes,
              p.created_at, p.updated_at, p.admin_decision_at,
              u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    // Messages for each proposal
    const proposalIds = proposals.map((p) => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT proposal_id, id, user_name, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }

    // Feedback: open and awaiting_approval
    const feedbacks = await db.all(
      `SELECT f.id, f.subject, f.message, f.category, f.status,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS author_name, u.email AS author_email, u.role AS author_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    // Threads for each feedback
    const feedbackIds = feedbacks.map((f) => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT feedback_id, id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    // Group messages by proposal
    const msgByProposal = {};
    for (const m of proposalMessages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }

    // Group messages by feedback
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }

    res.json({
      ok: true,
      run_date: '2026-06-09',
      proposals: proposals.map((p) => ({
        ...p,
        messages: msgByProposal[p.id] || [],
      })),
      feedbacks: feedbacks.map((f) => ({
        ...f,
        messages: msgByFeedback[f.id] || [],
      })),
    });
  }),
);

// POST endpoints for AI actions (proposals + feedback updates)
router.post(
  '/action',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const { type, ...payload } = req.body || {};

    if (type === 'proposal_done') {
      // Mark proposal as done
      const { id } = payload;
      await db.run(
        `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`,
        id,
      );
      return res.json({ ok: true, action: 'proposal_done', id });
    }

    if (type === 'proposal_create') {
      // Create new proposal
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = payload;
      const r = await db.run(
        `INSERT INTO ai_proposals
         (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?::jsonb,'pending',NOW(),NOW())
         RETURNING id`,
        title, summary, category || 'feature', risk || 'low', source || 'daily-run-2026-06-09',
        feedback_id || null,
        JSON.stringify(proposed_changes || []),
      );
      return res.json({ ok: true, action: 'proposal_create', id: r.lastInsertRowid });
    }

    if (type === 'proposal_revision_resubmit') {
      // Update proposal back to pending after revision
      const { id, summary, proposed_changes } = payload;
      await db.run(
        `UPDATE ai_proposals SET status='pending', summary=?, proposed_changes=?::jsonb, updated_at=NOW() WHERE id=?`,
        summary, JSON.stringify(proposed_changes || []), id,
      );
      return res.json({ ok: true, action: 'proposal_revision_resubmit', id });
    }

    if (type === 'proposal_message') {
      // Post message to proposal thread
      const { proposal_id, text } = payload;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at)
         VALUES (?, 'AI ассистент', ?, NOW())`,
        proposal_id, text,
      );
      return res.json({ ok: true, action: 'proposal_message', proposal_id });
    }

    if (type === 'feedback_status') {
      // Update feedback status + admin_reply
      const { id, status, admin_reply } = payload;
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=?, updated_at=NOW() WHERE id=?`,
        status, admin_reply || null, id,
      );
      return res.json({ ok: true, action: 'feedback_status', id, status });
    }

    if (type === 'feedback_message') {
      // Post message to feedback thread
      const { feedback_id, text } = payload;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
         VALUES (?, 'AI ассистент', 'admin', ?, NOW())`,
        feedback_id, text,
      );
      return res.json({ ok: true, action: 'feedback_message', feedback_id });
    }

    return res.status(400).json({ error: 'unknown type', type });
  }),
);

export default router;
