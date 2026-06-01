// TEMPORARY — ежедневный обход AI. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'ai-daily-20260601-k7Qm9pN2sX';
const router = Router();

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const action = req.query.action;
  try {
    if (action === 'get-proposals') {
      const status = req.query.status || null;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY created_at DESC`);
      return res.json({ data: rows });
    }

    if (action === 'get-feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC`,
      );
      const messages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(
           SELECT id FROM feedback WHERE status IN ('open','awaiting_approval','in_progress')
         ) ORDER BY feedback_id, created_at ASC, id ASC`,
      );
      const msgMap = {};
      for (const m of messages) {
        if (!msgMap[m.feedback_id]) msgMap[m.feedback_id] = [];
        msgMap[m.feedback_id].push(m);
      }
      return res.json({ data: feedbacks.map(f => ({ ...f, thread: msgMap[f.id] || [] })) });
    }

    if (action === 'patch-proposal') {
      const { id, decision, notes } = req.query;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
        decision, notes || null, id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (action === 'patch-feedback') {
      const { id, status, admin_reply } = req.query;
      await db.run(
        `UPDATE feedback SET status = COALESCE(?, status), admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status || null, admin_reply || null, id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
    }

    if (action === 'post-message') {
      const { feedback_id, text } = req.query;
      const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, admin?.id || null, text,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    if (action === 'create-proposal') {
      const data = JSON.parse(decodeURIComponent(req.query.data || '{}'));
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
      return res.json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
