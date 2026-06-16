// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода. Удалить сразу после использования.
// Секрет: одноразовый, только для этого запуска.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'dr26k9bm8xfq';
const router = Router();

router.use((req, res, next) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET ?s=SECRET&what=proposals → все ai_proposals сгруппированные по статусу (approved/revision/rejected/pending)
// GET ?s=SECRET&what=proposal_messages&id=X → сообщения треда предложения
// GET ?s=SECRET&what=feedback → все feedback open/awaiting_approval с сообщениями треда
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const what = req.query.what || 'proposals';

    if (what === 'proposals') {
      const statuses = ['approved', 'revision', 'rejected', 'pending'];
      const result = {};
      for (const status of statuses) {
        result[status] = await db.all(
          `SELECT p.*, f.subject AS feedback_subject
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           WHERE p.status = ?
           ORDER BY p.updated_at DESC NULLS LAST`,
          status,
        );
      }
      return res.json(result);
    }

    if (what === 'proposal_messages') {
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

    if (what === 'feedback') {
      const items = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.updated_at DESC NULLS LAST`,
      );
      // Загружаем треды для всех
      const ids = items.map((r) => r.id);
      const threads = ids.length
        ? await db.all(
            `SELECT feedback_id, id, user_name, role, text, created_at
             FROM feedback_messages
             WHERE feedback_id = ANY(?::int[])
             ORDER BY created_at ASC, id ASC`,
            `{${ids.join(',')}}`,
          )
        : [];
      const byFeedback = {};
      for (const m of threads) {
        if (!byFeedback[m.feedback_id]) byFeedback[m.feedback_id] = [];
        byFeedback[m.feedback_id].push(m);
      }
      return res.json({ data: items.map((f) => ({ ...f, thread: byFeedback[f.id] || [] })) });
    }

    return res.status(400).json({ error: 'unknown what' });
  }),
);

// POST ?s=SECRET  body: { action, ...params }
// action=patch_proposal → { id, decision, notes? }
// action=create_proposal → { title, summary, category, risk, source, proposed_changes?, feedback_id? }
// action=post_proposal_message → { id, text, user_name? }
// action=patch_feedback → { id, status, admin_reply? }
// action=post_feedback_message → { feedback_id, text, user_name? }
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { action, ...params } = req.body || {};

    if (action === 'patch_proposal') {
      const { id, decision, notes } = params;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, Number(id),
      );
      return res.json({ ok: true, id, decision });
    }

    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = params;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.status(201).json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'post_proposal_message') {
      const { id, text, user_name } = params;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, ?, 'admin', ?)`,
        Number(id), user_name || 'AI ассистент', text,
      );
      return res.json({ ok: true });
    }

    if (action === 'patch_feedback') {
      const { id, status, admin_reply } = params;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        status, admin_reply ?? null, Number(id),
      );
      return res.json({ ok: true, id, status });
    }

    if (action === 'post_feedback_message') {
      const { feedback_id, text, user_name } = params;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, ?, 'admin', ?)`,
        Number(feedback_id), user_name || 'AI ассистент', text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  }),
);

export default router;
