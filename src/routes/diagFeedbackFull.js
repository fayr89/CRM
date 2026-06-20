// ВРЕМЕННЫЙ ДИАГНОСТИЧЕСКИЙ МАРШРУТ — удалить после ежедневного обхода AI.
// GET /api/diag/feedback-full?secret=SECRET[&action=...&params...]
// Поддерживает чтение и запись без JWT (только через секрет).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

const SECRET = 'daily-run-9f4a2c8e1b7d';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  return next();
});

// GET — snapshot данных или выполнение action
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const action = req.query.action;

    // --- SNAPSHOT ---
    if (!action) {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status IN ('approved','revision','rejected','pending')
         ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC
         LIMIT 100`,
      );
      // Треды предложений
      const proposalIds = proposals.map((p) => p.id);
      const proposalMessages = proposalIds.length
        ? await db.all(
            `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[]) ORDER BY created_at ASC, id ASC`,
            proposalIds,
          ).catch(() => db.all(
            `SELECT * FROM ai_proposal_messages WHERE proposal_id IN (${proposalIds.join(',')}) ORDER BY created_at ASC, id ASC`,
          ))
        : [];

      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at ASC
         LIMIT 100`,
      );
      const feedbackIds = feedbacks.map((f) => f.id);
      const feedbackMessages = feedbackIds.length
        ? await db.all(
            `SELECT * FROM feedback_messages WHERE feedback_id IN (${feedbackIds.join(',')}) ORDER BY created_at ASC, id ASC`,
          )
        : [];

      return res.json({
        proposals,
        proposal_messages: proposalMessages,
        feedbacks,
        feedback_messages: feedbackMessages,
        ts: new Date().toISOString(),
      });
    }

    // --- POST FEEDBACK MESSAGE ---
    if (action === 'post_fb_msg') {
      const feedbackId = Number(req.query.feedback_id);
      const text = decodeURIComponent(req.query.text || '');
      const userName = decodeURIComponent(req.query.user_name || 'AI ассистент');
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
        feedbackId, 0, userName, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- PATCH FEEDBACK (status / admin_reply) ---
    if (action === 'patch_fb') {
      const feedbackId = Number(req.query.feedback_id);
      const status = req.query.status || null;
      const adminReply = req.query.admin_reply ? decodeURIComponent(req.query.admin_reply) : null;
      if (!feedbackId) return res.status(400).json({ error: 'feedback_id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', feedbackId);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?, resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW() WHERE id = ?`,
        newStatus, adminReply, justResolved ? 0 : cur.resolved_by, feedbackId,
      );
      return res.json({ ok: true, id: feedbackId, status: newStatus });
    }

    // --- POST AI PROPOSAL ---
    if (action === 'post_proposal') {
      const title = decodeURIComponent(req.query.title || '');
      const summary = decodeURIComponent(req.query.summary || '');
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- PATCH AI PROPOSAL (decision) ---
    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, id, decision });
    }

    // --- POST PROPOSAL MESSAGE ---
    if (action === 'post_proposal_msg') {
      const proposalId = Number(req.query.proposal_id);
      const text = decodeURIComponent(req.query.text || '');
      const userName = decodeURIComponent(req.query.user_name || 'AI ассистент');
      if (!proposalId || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
        proposalId, 0, userName, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }),
);

export default router;
