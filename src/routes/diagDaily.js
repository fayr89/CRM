// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода.
// Удалить сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'dRun-2026-06-01-v2-mQrL4w';

const router = Router();

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  try {
    const opRaw = req.query.op;
    const op = opRaw
      ? JSON.parse(Buffer.from(opRaw, 'base64url').toString('utf8'))
      : { action: 'read_all' };
    const { action } = op;

    const adminUser = await db.get(
      `SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id ASC LIMIT 1`,
    );
    const adminId = adminUser?.id;

    if (action === 'read_all') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','in_progress','awaiting_approval')
         ORDER BY f.created_at ASC`,
      );
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      const approved = await db.all(
        `SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`,
      );
      const revision = await db.all(
        `SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`,
      );
      const rejected = await db.all(
        `SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC`,
      );
      return res.json({ feedback: feedbacks, proposals: { approved, revision, rejected } });
    }

    if (action === 'post_message') {
      const { feedback_id, text } = op;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        feedback_id, adminId, text,
      );
      return res.json({ ok: true });
    }

    if (action === 'update_feedback') {
      const { feedback_id, status, admin_reply } = op;
      const cur = await db.get('SELECT id, status, resolved_by FROM feedback WHERE id = ?', feedback_id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status ?? cur.status;
      const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
        && !['awaiting_approval', 'closed'].includes(cur.status);
      if (justResolved) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
          newStatus, admin_reply ?? null, adminId, feedback_id,
        );
      } else {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW() WHERE id = ?`,
          newStatus, admin_reply ?? null, feedback_id,
        );
      }
      return res.json({ ok: true });
    }

    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = op;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary,
        category ?? null, risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'update_proposal') {
      const { id, decision } = op;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_by = ?,
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, adminId, id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
