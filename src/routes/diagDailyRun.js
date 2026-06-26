// ВРЕМЕННЫЙ диаг-эндпоинт для AI daily-run 2026-06-26-v11.
// Снести сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-daily-2026-06-26-v11-xK9m';

router.get('/daily-run-v11', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // ai_proposals (all statuses except done) with messages
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status != 'done'
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }
    const recentDone = await db.all(
      `SELECT id, title, status, feedback_id, updated_at
       FROM ai_proposals
       WHERE status = 'done' AND updated_at > NOW() - INTERVAL '2 days'
       ORDER BY updated_at DESC LIMIT 20`,
    );

    // feedback open/awaiting_approval with messages
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
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
      proposals: proposals.map(p => ({ ...p, messages: msgByProposal[p.id] || [] })),
      recent_done_proposals: recentDone,
      feedbacks: feedbacks.map(f => ({ ...f, messages: msgByFeedback[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-action-v11?secret=... — выполнить список write-действий
router.post('/daily-action-v11', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const actions = req.body?.actions;
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions array required' });
  const results = [];
  for (const act of actions) {
    try {
      if (act.type === 'feedback_status') {
        await db.run('UPDATE feedback SET status=?, updated_at=NOW() WHERE id=?', act.status, act.id);
        results.push({ ok: true, action: act });
      } else if (act.type === 'feedback_message') {
        const row = await db.get(
          `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
           VALUES (?, ?, 'admin', ?, NOW()) RETURNING id`,
          act.feedback_id, act.user_name || 'AI ассистент', act.text,
        );
        results.push({ ok: true, action: act, inserted_id: row?.id });
      } else if (act.type === 'proposal_patch') {
        const sets = [];
        const vals = [];
        if (act.status) { sets.push('status=?'); vals.push(act.status); }
        if (act.summary) { sets.push('summary=?'); vals.push(act.summary); }
        if (act.admin_notes !== undefined) { sets.push('admin_notes=?'); vals.push(act.admin_notes); }
        if (sets.length) {
          vals.push(act.id);
          await db.run(`UPDATE ai_proposals SET ${sets.join(',')}, updated_at=NOW() WHERE id=?`, ...vals);
        }
        results.push({ ok: true, action: act });
      } else if (act.type === 'proposal_message') {
        const row = await db.get(
          `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at)
           VALUES (?, ?, ?, NOW()) RETURNING id`,
          act.proposal_id, act.user_name || 'AI ассистент', act.text,
        );
        results.push({ ok: true, action: act, inserted_id: row?.id });
      } else if (act.type === 'proposal_create') {
        const row = await db.get(
          `INSERT INTO ai_proposals
             (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
          act.title, act.summary, act.category, act.risk, act.source,
          JSON.stringify(act.proposed_changes || []), act.feedback_id || null,
        );
        results.push({ ok: true, action: act, inserted_id: row?.id });
      } else {
        results.push({ ok: false, error: 'unknown action type', action: act });
      }
    } catch (e) {
      results.push({ ok: false, error: e.message, action: act });
    }
  }
  res.json({ results });
});

export default router;
