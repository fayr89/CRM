// TEMP: ежедневный обход AI — одноразовый diag-эндпоинт.
// После завершения сеанса сносится отдельным коммитом.
// Доступ только по секрету в query ?s=
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'f8a2c41e9d7b';
const router = Router();

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { op } = req.query;

    // Список предложений по статусу
    if (op === 'proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC`,
        status,
      );
      return res.json({ data: rows });
    }

    // Сообщения треда предложения
    if (op === 'proposal-msgs') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // Pending-предложения с новыми сообщениями от админа
    if (op === 'pending-with-msgs') {
      const pending = await db.all(
        `SELECT p.id, p.title, p.status, p.created_at FROM ai_proposals p WHERE p.status = 'pending'`,
      );
      const result = [];
      for (const p of pending) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
        if (msgs.length > 0) result.push({ ...p, messages: msgs });
      }
      return res.json({ data: result });
    }

    // Все обращения со статусом open или awaiting_approval + их треды
    if (op === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      const result = [];
      for (const fb of feedbacks) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    // Пометить предложение done (или другой статус)
    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        id,
      );
      const row = await db.get('SELECT id, status, title FROM ai_proposals WHERE id = ?', id);
      return res.json(row);
    }

    // Добавить сообщение в тред обращения
    if (op === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
      const adminId = adminUser?.id || null;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, ?, 'AI ассистент', 'admin', ?, NULL) RETURNING id, created_at`,
        feedback_id,
        adminId,
        text,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    // Обновить статус обращения
    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply ? decodeURIComponent(req.query.admin_reply) : null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status,
        admin_reply,
        id,
      );
      const row = await db.get('SELECT id, status, subject FROM feedback WHERE id = ?', id);
      return res.json(row);
    }

    // Создать AI-предложение (data — JSON, URL-encoded)
    if (op === 'post-proposal') {
      const raw = req.query.data ? decodeURIComponent(req.query.data) : null;
      if (!raw) return res.status(400).json({ error: 'data required' });
      let data;
      try { data = JSON.parse(raw); } catch { return res.status(400).json({ error: 'data is not valid JSON' }); }
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
      const created = await db.get('SELECT id, title, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json(created);
    }

    // Добавить сообщение в тред предложения
    if (op === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
      const adminId = adminUser?.id || null;
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        id,
        adminId,
        text,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown op', available: ['proposals', 'proposal-msgs', 'pending-with-msgs', 'feedback-full', 'patch-proposal', 'post-feedback-msg', 'patch-feedback', 'post-proposal', 'post-proposal-msg'] });
  }),
);

export default router;
