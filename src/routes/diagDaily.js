// TEMP — ежедневный AI-обход 2026-06-06-v51. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-06-v51-k2p7mq';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-read?secret=... — все данные для AI-обхода
router.get('/daily-read', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status != 'done'
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
    );

    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC`,
    );

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[]) ORDER BY created_at ASC`,
      );
    }

    const proposalMsgMap = {};
    for (const m of proposalMessages) {
      if (!proposalMsgMap[m.proposal_id]) proposalMsgMap[m.proposal_id] = [];
      proposalMsgMap[m.proposal_id].push(m);
    }
    const feedbackMsgMap = {};
    for (const m of feedbackMessages) {
      if (!feedbackMsgMap[m.feedback_id]) feedbackMsgMap[m.feedback_id] = [];
      feedbackMsgMap[m.feedback_id].push(m);
    }

    res.json({
      proposals: proposals.map(p => ({ ...p, messages: proposalMsgMap[p.id] || [] })),
      feedbacks: feedbacks.map(f => ({ ...f, messages: feedbackMsgMap[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-act?secret=...&actions=<base64url-json> — выполнить список действий
router.get('/daily-act', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const raw = req.query.actions;
  if (!raw) return res.status(400).json({ error: 'actions required' });
  let actions;
  try {
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    actions = JSON.parse(decoded);
  } catch (e) {
    return res.status(400).json({ error: 'invalid actions: ' + e.message });
  }

  const results = [];
  const adminUserId = (await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`))?.id;

  for (const act of actions) {
    try {
      if (act.type === 'create_proposal') {
        const r = await db.run(
          `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          act.feedback_id ?? null,
          act.title,
          act.summary,
          act.category ?? null,
          act.risk || 'medium',
          act.source ?? null,
          act.proposed_changes ? JSON.stringify(act.proposed_changes) : null,
        );
        results.push({ type: act.type, id: r.lastInsertRowid, ok: true });

      } else if (act.type === 'patch_proposal') {
        await db.run(
          `UPDATE ai_proposals SET status = ?, admin_notes = ?,
           admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          act.decision, act.notes ?? null, adminUserId, act.id,
        );
        results.push({ type: act.type, id: act.id, ok: true });

      } else if (act.type === 'proposal_message') {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
          act.id, adminUserId, act.text,
        );
        results.push({ type: act.type, id: act.id, ok: true });

      } else if (act.type === 'patch_feedback') {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', act.id);
        if (!cur) { results.push({ type: act.type, id: act.id, ok: false, error: 'not found' }); continue; }
        const newStatus = act.status ?? cur.status;
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
           resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
           updated_at = NOW() WHERE id = ?`,
          newStatus, act.admin_reply ?? null,
          justResolved, adminUserId,
          justResolved,
          act.id,
        );
        results.push({ type: act.type, id: act.id, ok: true });

      } else if (act.type === 'feedback_message') {
        const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', act.id);
        if (!fb) { results.push({ type: act.type, id: act.id, ok: false, error: 'not found' }); continue; }
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
          act.id, adminUserId, act.text,
        );
        results.push({ type: act.type, id: act.id, ok: true });

      } else {
        results.push({ type: act.type, ok: false, error: 'unknown type' });
      }
    } catch (e) {
      results.push({ type: act.type, ok: false, error: e.message });
    }
  }
  res.json({ results });
});

export default router;
