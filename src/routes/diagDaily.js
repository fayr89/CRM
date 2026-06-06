// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const DIAG_SECRET = 'pL5nX8tKqW2mR9vJ3cZ6hB4yG7dN1eU';

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get('/daily-data', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const [proposals_approved, proposals_revision, proposals_rejected, proposals_pending, feedbacks] = await Promise.all([
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'approved' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'revision' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'rejected' ORDER BY p.updated_at DESC`),
      db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = 'pending' ORDER BY p.updated_at DESC`),
      db.all(`SELECT f.*, u.name AS author_name, u.email AS author_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.updated_at DESC LIMIT 100`),
    ]);

    const allProposalIds = [
      ...proposals_approved,
      ...proposals_revision,
      ...proposals_rejected,
      ...proposals_pending,
    ].map(p => p.id);

    let proposalMessages = {};
    if (allProposalIds.length > 0) {
      const msgs = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY($1::int[]) ORDER BY created_at ASC, id ASC`,
        allProposalIds,
      );
      for (const m of msgs) {
        if (!proposalMessages[m.proposal_id]) proposalMessages[m.proposal_id] = [];
        proposalMessages[m.proposal_id].push(m);
      }
    }

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackThreads = {};
    if (feedbackIds.length > 0) {
      const threads = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY($1::int[]) ORDER BY created_at ASC, id ASC`,
        feedbackIds,
      );
      for (const t of threads) {
        if (!feedbackThreads[t.feedback_id]) feedbackThreads[t.feedback_id] = [];
        feedbackThreads[t.feedback_id].push(t);
      }
    }

    res.json({
      proposals: {
        approved: proposals_approved.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        revision: proposals_revision.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        rejected: proposals_rejected.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
        pending: proposals_pending.map(p => ({ ...p, messages: proposalMessages[p.id] || [] })),
      },
      feedbacks: feedbacks.map(f => ({ ...f, thread: feedbackThreads[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Запись: POST /api/diag/write?secret=...
// body: { action, ...params }
// actions: post_feedback_msg, post_proposal_msg, patch_proposal, create_proposal, patch_feedback
router.post('/write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { action, ...params } = req.body || {};
  try {
    if (action === 'post_feedback_msg') {
      const { feedback_id, text } = params;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'post_proposal_msg') {
      const { proposal_id, text } = params;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'patch_proposal') {
      const { proposal_id, status, notes } = params;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
        status, notes ?? null, proposal_id,
      );
      return res.json({ ok: true });
    }
    if (action === 'create_proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = params;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'patch_feedback') {
      const { feedback_id, status, admin_reply } = params;
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status ?? cur.status;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        newStatus, admin_reply ?? null, feedback_id,
      );
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action: ' + action });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
