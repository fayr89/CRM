// TEMP: daily AI-run diag endpoint 2026-06-10-v13
// DELETE THIS FILE AND REMOVE FROM app.js AFTER USE
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v13-ZpM4-2026-06-10';

function checkSecret(s) {
  return s === SECRET;
}

// GET /api/diag/daily-v13?s=SECRET — read all proposals + feedback with threads
router.get('/', async (req, res) => {
  if (!checkSecret(req.query.s)) return res.status(403).json({ error: 'forbidden' });
  try {
    const [approvedProposals, revisionProposals, rejectedProposals, pendingProposals] = await Promise.all([
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'approved' ORDER BY p.created_at DESC LIMIT 50`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'revision' ORDER BY p.created_at DESC LIMIT 50`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'rejected' ORDER BY p.created_at DESC LIMIT 50`),
      db.all(`SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
              FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
              WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 50`),
    ]);

    // Load threads for all proposals
    const allProposals = [...approvedProposals, ...revisionProposals, ...rejectedProposals, ...pendingProposals];
    const proposalIds = allProposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      );
    }
    const proposalThreads = {};
    for (const m of proposalMessages) {
      if (!proposalThreads[m.proposal_id]) proposalThreads[m.proposal_id] = [];
      proposalThreads[m.proposal_id].push(m);
    }
    for (const p of allProposals) p.messages = proposalThreads[p.id] || [];

    // Feedback: open + awaiting_approval
    const feedbackRows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC
       LIMIT 100`,
    );
    const fbIds = feedbackRows.map(f => f.id);
    let fbMessages = [];
    if (fbIds.length > 0) {
      fbMessages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      );
    }
    const fbThreads = {};
    for (const m of fbMessages) {
      if (!fbThreads[m.feedback_id]) fbThreads[m.feedback_id] = [];
      fbThreads[m.feedback_id].push(m);
    }
    for (const f of feedbackRows) f.messages = fbThreads[f.id] || [];

    res.json({
      proposals: {
        approved: approvedProposals,
        revision: revisionProposals,
        rejected: rejectedProposals,
        pending: pendingProposals,
      },
      feedback: feedbackRows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v13 — write operations
// op: 'feedback-message' | 'update-feedback' | 'create-proposal' | 'patch-proposal'
router.post('/', async (req, res) => {
  const { s, op, ...data } = req.body || {};
  if (!checkSecret(s)) return res.status(403).json({ error: 'forbidden' });
  try {
    if (op === 'feedback-message') {
      // Post message to feedback thread as AI ассистент
      const { feedback_id, text } = data;
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'update-feedback') {
      // Update feedback status and/or admin_reply
      const { feedback_id, status, admin_reply } = data;
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = status ?? cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        newStatus,
        admin_reply ?? null,
        feedback_id,
      );
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = data;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk ?? 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-proposal') {
      // Mark proposal done (or other decision)
      const { id, decision, notes } = data;
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'proposal not found' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json({ ok: true });
    }

    if (op === 'proposal-message') {
      // Post message to proposal thread as AI ассистент
      const { proposal_id, text } = data;
      const p = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposal_id);
      if (!p) return res.status(404).json({ error: 'proposal not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
