// TEMP — ежедневный AI-обход. Удалить после использования.
// Защищён одноразовым секретом в query ?secret=
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-diag-20260606-p2n8w';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET — полный дамп: ai_proposals (all statuses) + messages + feedback (open/awaiting)
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
                WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                p.created_at DESC
       LIMIT 200`,
    );
    const proposalIds = proposals.map(p => p.id);
    let propMessages = [];
    if (proposalIds.length > 0) {
      propMessages = await db.all(
        `SELECT id, proposal_id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY proposal_id, created_at ASC, id ASC`,
      );
    }
    const msgByProposal = {};
    for (const m of propMessages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }
    const enrichedProposals = proposals.map(p => ({ ...p, messages: msgByProposal[p.id] || [] }));

    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC
       LIMIT 100`,
    );
    const feedbackIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
      );
    }
    const msgByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    const enrichedFeedback = feedback.map(f => ({ ...f, thread: msgByFeedback[f.id] || [] }));

    res.json({ proposals: enrichedProposals, feedback: enrichedFeedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST — write operations
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { action } = req.body || {};
  try {
    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (action === 'patch_proposal') {
      const { id, decision, notes } = req.body;
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (action === 'post_proposal_message') {
      const { proposal_id, text, user_name } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, ?, 'admin', ?) RETURNING id, created_at`,
        proposal_id, user_name || 'AI ассистент', text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'post_feedback_message') {
      const { feedback_id, text, user_name } = req.body;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, ?, 'admin', ?) RETURNING id, created_at`,
        feedback_id, user_name || 'AI ассистент', text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'update_feedback') {
      const { feedback_id, status, admin_reply } = req.body;
      const sets = ['updated_at = NOW()'];
      const vals = [];
      if (status) { sets.push('status = ?'); vals.push(status); }
      if (admin_reply !== undefined) { sets.push('admin_reply = ?'); vals.push(admin_reply); }
      vals.push(feedback_id);
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
