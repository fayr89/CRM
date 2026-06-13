// TEMP: одноразовый диаг-эндпоинт для ежедневного AI-обхода обращений.
// Секрет: ?secret=m8q4r2j6t9y3 — сносится сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'm8q4r2j6t9y3';

function guard(req, res, next) {
  if (req.query?.secret === SECRET) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// GET /api/diag/daily-run?secret=... → ai_proposals + feedback с тредами
router.get(
  '/daily-run',
  guard,
  asyncHandler(async (_req, res) => {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                p.created_at DESC`,
    );

    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC`,
    );

    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    // Также достать POST-эндпоинт для посева сообщений через PATCH/POST
    res.json({
      proposals,
      proposal_messages: proposalMessages,
      feedbacks,
      feedback_messages: feedbackMessages,
    });
  }),
);

// POST /api/diag/daily-run/action?secret=... — выполнить действие (post message, patch feedback, etc.)
router.post(
  '/daily-run/action',
  guard,
  asyncHandler(async (req, res) => {
    const { type, ...data } = req.body || {};

    if (type === 'post_feedback_message') {
      // { feedback_id, text, user_name }
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id, created_at`,
        data.feedback_id,
        data.user_name || 'AI ассистент',
        data.text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (type === 'patch_feedback') {
      // { feedback_id, status, admin_reply }
      await db.run(
        `UPDATE feedback SET status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply), updated_at = NOW()
         WHERE id = ?`,
        data.status ?? null,
        data.admin_reply ?? null,
        data.feedback_id,
      );
      return res.json({ ok: true });
    }

    if (type === 'post_proposal_message') {
      // { proposal_id, text, user_name }
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id, created_at`,
        data.proposal_id,
        data.user_name || 'AI ассистент',
        data.text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (type === 'create_proposal') {
      // { title, summary, category, risk, source, feedback_id, proposed_changes }
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (type === 'patch_proposal') {
      // { proposal_id, decision, notes }
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        data.decision,
        data.notes ?? null,
        data.proposal_id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown type' });
  }),
);

export default router;
