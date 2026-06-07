// TEMP diag — ежедневный AI-обход. Сносить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-07-c9f3';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-data?secret=X
router.get('/daily-data', async (req, res) => {
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
       WHERE p.status != 'done'
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );

    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY proposal_id, created_at ASC, id ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }

    const msgsByProposal = {};
    for (const m of proposalMessages) {
      if (!msgsByProposal[m.proposal_id]) msgsByProposal[m.proposal_id] = [];
      msgsByProposal[m.proposal_id].push(m);
    }
    const proposalsWithMsgs = proposals.map(p => ({ ...p, messages: msgsByProposal[p.id] || [] }));

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.updated_at DESC
       LIMIT 100`,
    );

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }

    const msgsByFeedback = {};
    for (const m of feedbackMessages) {
      if (!msgsByFeedback[m.feedback_id]) msgsByFeedback[m.feedback_id] = [];
      msgsByFeedback[m.feedback_id].push(m);
    }
    const feedbacksWithMsgs = feedbacks.map(f => ({ ...f, messages: msgsByFeedback[f.id] || [] }));

    res.json({ proposals: proposalsWithMsgs, feedbacks: feedbacksWithMsgs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-write?secret=X&op=OP&data=BASE64_JSON
router.get('/daily-write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { op, data: dataB64 } = req.query;
  let payload = {};
  try {
    if (dataB64) payload = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'bad data param: ' + e.message });
  }

  try {
    if (op === 'patch_proposal') {
      const { id, decision, notes } = payload;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json({ ok: true, id });
    }

    if (op === 'post_proposal_msg') {
      const { id, text, user_name } = payload;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        id, user_name || 'AI ассистент', text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'post_proposal') {
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = payload;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary,
        category ?? null, risk ?? 'medium',
        source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'post_feedback_msg') {
      const { feedback_id, text, user_name } = payload;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        feedback_id, user_name || 'AI ассистент', text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch_feedback') {
      const { id, status, admin_reply } = payload;
      const sets = [];
      const vals = [];
      if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
      if (admin_reply !== undefined) { sets.push('admin_reply = ?'); vals.push(admin_reply); }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      sets.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
      return res.json({ ok: true, id });
    }

    res.status(400).json({ error: 'unknown op: ' + op });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
