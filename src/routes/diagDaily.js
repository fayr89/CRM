// TEMP: диагностический эндпоинт для ежедневного AI-обхода обращений.
// Секрет одноразовый — удалить файл и маршрут в app.js после использования.
// daily-run 2026-06-12-s10
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const S = 'k7m3j9p2'; // one-time secret

router.use((req, res, next) => {
  if (req.query?.s !== S) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action, id, status, decision, notes, text, admin_reply } = req.query;
    const numId = Number(id) || 0;

    // --- Чтение предложений по статусу ---
    if (action === 'proposals') {
      const where = status ? 'WHERE p.status = ?' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                p.status, p.feedback_id, p.admin_notes, p.created_at, p.updated_at,
                f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where}
         ORDER BY p.created_at DESC LIMIT 100`,
        ...params,
      );
      return res.json({ data: rows });
    }

    // --- Тред предложения ---
    if (action === 'proposal-messages') {
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        numId,
      );
      return res.json({ data: rows });
    }

    // --- Патч предложения (decision: done|approved|rejected|revision) ---
    if (action === 'patch-proposal') {
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         admin_decision_by = NULL, admin_decision_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        decision, notes || null, numId,
      );
      return res.json({ ok: true, id: numId, decision });
    }

    // --- Сообщение в тред предложения ---
    if (action === 'post-proposal-msg') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        numId, text,
      );
      return res.json({ ok: true });
    }

    // --- Создать предложение (данные в query-param data как JSON) ---
    if (action === 'create-proposal') {
      let d;
      try { d = JSON.parse(req.query.data || '{}'); } catch { return res.status(400).json({ error: 'bad data json' }); }
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        d.feedback_id ?? null,
        d.title,
        d.summary,
        d.category ?? null,
        d.risk || 'medium',
        d.source ?? null,
        d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
      );
      return res.status(201).json({ ok: true, id: r.lastInsertRowid });
    }

    // --- Все открытые/ожидающие обращения с тредами ---
    if (action === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.context,
                f.status, f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      for (const fb of feedbacks) {
        fb.thread = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ data: feedbacks, count: feedbacks.length });
    }

    // --- Патч статуса обращения ---
    if (action === 'patch-feedback') {
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', numId);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      const resolvedBy = justResolved ? null : cur.resolved_by;
      const resolvedAtSql = justResolved ? 'NOW()' : 'resolved_at';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?,
           resolved_at = ${resolvedAtSql},
           updated_at = NOW()
         WHERE id = ?`,
        newStatus, admin_reply || null, resolvedBy, numId,
      );
      return res.json({ ok: true, id: numId, status: newStatus });
    }

    // --- Сообщение в тред обращения (от AI) ---
    if (action === 'post-feedback-msg') {
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', numId);
      if (!fb) return res.status(404).json({ error: 'not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        numId, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action', valid_actions: [
      'proposals', 'proposal-messages', 'patch-proposal', 'post-proposal-msg',
      'create-proposal', 'feedback-full', 'patch-feedback', 'post-feedback-msg',
    ] });
  }),
);

export default router;
