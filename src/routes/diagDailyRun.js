// TEMP: ежедневный обход AI 2026-06-08-v34. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'c8f2a5d9b3e7c1f4a8d2b6e9c3f7a1d5';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    const action = String(req.query.action || '');

    // Список предложений по статусу
    if (action === 'proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id, fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC`,
        status,
      );
      return res.json({ data: rows });
    }

    // Тред сообщений предложения
    if (action === 'proposal_messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // Пометить предложение выполненным
    if (action === 'proposal_done') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id);
      return res.json({ ok: true, id });
    }

    // Все обращения open/awaiting_approval с тредами
    if (action === 'feedback_full') {
      const rows = await db.all(
        `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );
      for (const fb of rows) {
        fb.thread = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ data: rows });
    }

    // Добавить сообщение в тред обращения (от AI ассистента)
    if (action === 'fb_msg') {
      const id = Number(req.query.id);
      const text = req.query.msg ? String(req.query.msg) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and msg required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true, id });
    }

    // Обновить статус обращения
    if (action === 'fb_status') {
      const id = Number(req.query.id);
      const status = req.query.status || 'awaiting_approval';
      const reply = req.query.reply ? String(req.query.reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
      if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), updated_at=NOW() WHERE id=?`,
        status, reply, id,
      );
      return res.json({ ok: true, id, status });
    }

    // Создать ai_proposal (data = base64(JSON))
    if (action === 'create_proposal') {
      const dataStr = req.query.data ? String(req.query.data) : '';
      if (!dataStr) return res.status(400).json({ error: 'data required' });
      let data;
      try {
        data = JSON.parse(Buffer.from(dataStr, 'base64').toString('utf8'));
      } catch (e) {
        return res.status(400).json({ error: `invalid data: ${e.message}` });
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // Добавить сообщение в тред предложения
    if (action === 'proposal_msg') {
      const id = Number(req.query.id);
      const text = req.query.msg ? String(req.query.msg) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and msg required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true, id });
    }

    return res.status(400).json({
      error: 'unknown action',
      actions: [
        'proposals', 'proposal_messages', 'proposal_done', 'proposal_msg',
        'feedback_full', 'fb_msg', 'fb_status', 'create_proposal',
      ],
    });
  }),
);

export default router;
