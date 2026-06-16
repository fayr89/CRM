// TEMP: Диагностический эндпоинт для ежедневного обхода обращений AI.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr_8f2a91e4c5b7';

// Все операции — GET с ?secret=... для обхода auth (web_fetch_vercel_url не поддерживает POST).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

    const action = req.query.action || '';

    // --- ЧТЕНИЕ ---

    if (action === 'get-proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC
         LIMIT 100`,
        status,
      );
      return res.json({ data: rows });
    }

    if (action === 'get-proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (action === 'get-feedback-full') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
         ORDER BY f.created_at DESC
         LIMIT 200`,
      );
      for (const fb of rows) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ data: rows });
    }

    // --- ЗАПИСЬ ---

    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        id,
      );
      return res.json({ ok: true, id, decision });
    }

    if (action === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const adminReply = req.query.admin_reply ? decodeURIComponent(req.query.admin_reply) : null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') AND status NOT IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = ?`,
        status,
        adminReply,
        status,
        id,
      );
      return res.json({ ok: true, id, status });
    }

    if (action === 'post-feedback-message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : '';
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedbackId,
        text,
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    if (action === 'post-proposal') {
      const title = req.query.title ? decodeURIComponent(req.query.title) : '';
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source ? decodeURIComponent(req.query.source) : null;
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changes = req.query.proposed_changes ? decodeURIComponent(req.query.proposed_changes) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedbackId,
        title,
        summary,
        category,
        risk,
        source,
        changes,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown action', actions: ['get-proposals', 'get-proposal-messages', 'get-feedback-full', 'patch-proposal', 'post-proposal-message', 'patch-feedback', 'post-feedback-message', 'post-proposal'] });
  }),
);

export default router;
