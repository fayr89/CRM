// TEMP — ежедневный AI-обход 2026-06-18 ig3kmx. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ig3kmx-daily-2026-06-18';

function guard(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

// Все ai_proposals (pending/approved/revision/rejected) + их треды
router.get('/proposals', guard, async (req, res) => {
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ORDER BY p.created_at DESC
       LIMIT 200`,
    );
    const messages = await db.all(
      `SELECT m.* FROM ai_proposal_messages m
       ORDER BY m.created_at ASC, m.id ASC`,
    );
    const msgByProposal = {};
    for (const m of messages) {
      if (!msgByProposal[m.proposal_id]) msgByProposal[m.proposal_id] = [];
      msgByProposal[m.proposal_id].push(m);
    }
    res.json({ proposals, messages: msgByProposal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Все обращения со статусами open/awaiting_approval + треды
router.get('/feedback-full', guard, async (req, res) => {
  try {
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.updated_at DESC
       LIMIT 100`,
    );
    const messages = await db.all(
      `SELECT m.* FROM feedback_messages m
       WHERE m.feedback_id = ANY(SELECT id FROM feedback WHERE status IN ('open','awaiting_approval'))
       ORDER BY m.created_at ASC`,
    );
    const msgByFeedback = {};
    for (const m of messages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    res.json({ feedbacks, messages: msgByFeedback });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Выполнение действий: patch proposal, post feedback_message, patch feedback status
router.post('/actions', guard, async (req, res) => {
  try {
    const { actions } = req.body;
    const results = [];
    for (const a of actions || []) {
      if (a.type === 'patch_proposal') {
        await db.run(
          `UPDATE ai_proposals SET status=?, updated_at=NOW() WHERE id=?`,
          a.status, a.id,
        );
        results.push({ ok: true, type: a.type, id: a.id });
      } else if (a.type === 'post_proposal_message') {
        const r = await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
           VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id`,
          a.proposal_id, a.text,
        );
        results.push({ ok: true, type: a.type, id: r.lastInsertRowid });
      } else if (a.type === 'post_feedback_message') {
        const r = await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
           VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id`,
          a.feedback_id, a.text,
        );
        results.push({ ok: true, type: a.type, id: r.lastInsertRowid });
      } else if (a.type === 'patch_feedback') {
        const sets = [];
        const vals = [];
        if (a.status) { sets.push('status=?'); vals.push(a.status); }
        if (a.admin_reply !== undefined) { sets.push('admin_reply=?'); vals.push(a.admin_reply); }
        sets.push('updated_at=NOW()');
        vals.push(a.id);
        await db.run(`UPDATE feedback SET ${sets.join(',')} WHERE id=?`, ...vals);
        results.push({ ok: true, type: a.type, id: a.id });
      } else if (a.type === 'create_proposal') {
        const changesJson = a.proposed_changes ? JSON.stringify(a.proposed_changes) : null;
        const r = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          a.feedback_id ?? null,
          a.title,
          a.summary,
          a.category ?? 'feature',
          a.risk ?? 'medium',
          a.source ?? 'daily-run-2026-06-18',
          changesJson,
        );
        results.push({ ok: true, type: a.type, id: r.lastInsertRowid });
      } else {
        results.push({ ok: false, type: a.type, error: 'unknown action type' });
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
