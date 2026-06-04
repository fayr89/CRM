// TEMPORARY — ежедневный AI-обход. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-daily-4c9dK2mQx8';

function checkSecret(req, res) {
  const s = req.query.secret || req.body?.secret;
  if (s !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET ?secret=...&op=proposals[&status=approved]
// GET ?secret=...&op=feedback-full
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { op, status } = req.query;

    if (op === 'proposals') {
      const rows = status
        ? await db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
             FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
             WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`, status)
        : await db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
             FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
             ORDER BY p.created_at DESC LIMIT 100`);
      return res.json({ data: rows });
    }

    if (op === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC LIMIT 200`,
      );
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ data: feedbacks });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST { secret, op, ...params }
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { op } = req.body;

    if (op === 'post-proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (op === 'patch-proposal') {
      const { id, decision, notes } = req.body;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = req.body;
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = CASE WHEN ? IN ('awaiting_approval','closed')
             AND status NOT IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = ?`,
        status ?? null, admin_reply ?? null, status ?? null, id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
    }

    if (op === 'post-message') {
      const { feedback_id, text } = req.body;
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.status(201).json(
        await db.get('SELECT * FROM feedback_messages WHERE id = ?', r.lastInsertRowid),
      );
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
