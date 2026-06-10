// TEMP: ежедневный AI-обход 2026-06-10-v30. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr30-8yz4-2026-06-10';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run-30?secret=X  → всё нужное для обхода
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${proposalIds.map(() => '?').join(',')}]::int[]) ORDER BY created_at ASC, id ASC`,
        ...proposalIds,
      );
    }
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const feedbackIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${feedbackIds.map(() => '?').join(',')}]::int[]) ORDER BY created_at ASC, id ASC`,
        ...feedbackIds,
      );
    }
    const msgByProposal = {};
    for (const m of proposalMessages) {
      (msgByProposal[m.proposal_id] = msgByProposal[m.proposal_id] || []).push(m);
    }
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      (msgByFeedback[m.feedback_id] = msgByFeedback[m.feedback_id] || []).push(m);
    }
    res.json({
      proposals: proposals.map(p => ({ ...p, messages: msgByProposal[p.id] || [] })),
      feedback: feedback.map(f => ({ ...f, messages: msgByFeedback[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run-30?secret=X  { op, ...payload }
router.post('/', async (req, res) => {
  if (!guard(req, res)) return;
  const { op, ...payload } = req.body || {};
  try {
    if (op === 'patch_proposal') {
      const { id, decision, notes } = payload;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json({ ok: true });
    }
    if (op === 'create_proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = payload;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary,
        category ?? null, risk ?? 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ id: r.lastInsertRowid });
    }
    if (op === 'proposal_message') {
      const { proposal_id, text } = payload;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        proposal_id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'feedback_message') {
      const { feedback_id, text } = payload;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        feedback_id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'patch_feedback') {
      const { id, status, admin_reply } = payload;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply ?? null, id,
      );
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
