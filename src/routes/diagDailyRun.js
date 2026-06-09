// TEMP: AI ежедневный обход v57. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr57-a9f3b2e8c1d5';

// GET /api/diag/data?token=... — все proposals + open/awaiting feedback с тредами
router.get(
  '/data',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    const proposals = await db.all(
      `SELECT p.id, p.title, p.summary, p.category, p.risk, p.status,
              p.source, p.feedback_id, p.admin_notes, p.proposed_changes,
              p.created_at, p.updated_at
       FROM ai_proposals p
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC`,
    );

    const proposalIds = proposals.map(p => p.id);
    const pMessages = proposalIds.length
      ? await db.all(
          `SELECT id, proposal_id, text, user_name, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
           ORDER BY created_at ASC`,
        )
      : [];

    const feedbacks = await db.all(
      `SELECT f.id, f.subject, f.message, f.category, f.status,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const fbIds = feedbacks.map(f => f.id);
    const fbMessages = fbIds.length
      ? await db.all(
          `SELECT id, feedback_id, text, user_name, role, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY(ARRAY[${fbIds.join(',')}]::int[])
           ORDER BY created_at ASC`,
        )
      : [];

    const proposalsByid = {};
    proposals.forEach(p => { proposalsByid[p.id] = { ...p, messages: [] }; });
    pMessages.forEach(m => {
      if (proposalsByid[m.proposal_id]) proposalsByid[m.proposal_id].messages.push(m);
    });

    const fbById = {};
    feedbacks.forEach(f => { fbById[f.id] = { ...f, messages: [] }; });
    fbMessages.forEach(m => {
      if (fbById[m.feedback_id]) fbById[m.feedback_id].messages.push(m);
    });

    res.json({
      proposals: Object.values(proposalsByid),
      feedbacks: Object.values(fbById),
    });
  }),
);

// POST /api/diag/action?token=... — выполнить действие
// body: { action, ...params }
// actions:
//   patch_proposal  { id, decision } — PATCH proposal decision
//   post_proposal_msg { id, text }   — POST в тред proposal
//   post_feedback_msg { id, text }   — POST в тред feedback от AI ассистент
//   update_feedback { id, status, admin_reply } — PATCH feedback
//   create_proposal { title, summary, category, risk, source, proposed_changes, feedback_id }
router.post(
  '/action',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const { action } = req.body || {};

    if (action === 'patch_proposal') {
      const { id, decision } = req.body;
      const allowed = ['done', 'pending'];
      if (!allowed.includes(decision)) return res.status(400).json({ error: 'invalid decision' });
      const fieldMap = { done: 'done', pending: 'pending' };
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        fieldMap[decision],
        id,
      );
      return res.json({ ok: true });
    }

    if (action === 'post_proposal_msg') {
      const { id, text } = req.body;
      const row = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, text, user_name, created_at)
         VALUES (?, ?, 'AI ассистент', NOW()) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, id: row.id });
    }

    if (action === 'post_feedback_msg') {
      const { id, text } = req.body;
      const row = await db.run(
        `INSERT INTO feedback_messages (feedback_id, text, user_name, role, created_at)
         VALUES (?, ?, 'AI ассистент', 'admin', NOW()) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, id: row.id });
    }

    if (action === 'update_feedback') {
      const { id, status, admin_reply } = req.body;
      const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
      if (status && !allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
      const sets = [];
      const params = [];
      if (status) { sets.push('status = ?'); params.push(status); }
      if (admin_reply !== undefined) { sets.push('admin_reply = ?'); params.push(admin_reply); }
      sets.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
      return res.json({ ok: true });
    }

    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body;
      const row = await db.run(
        `INSERT INTO ai_proposals
           (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
        title,
        summary,
        category || 'feature',
        risk || 'medium',
        source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify(proposed_changes || []),
        feedback_id || null,
      );
      return res.json({ ok: true, id: row.id });
    }

    res.status(400).json({ error: 'unknown action' });
  }),
);

export default router;
