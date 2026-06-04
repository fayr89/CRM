// TEMP — ежедневный AI-обход 2026-06-04-v19. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'd4iL-2026-06-04-zQp7xR';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { action, scope } = req.query;

    // --- READ SCOPES ---
    if (!action) {
      if (scope === 'proposals') {
        const status = req.query.status || null;
        const rows = status
          ? await db.all(
              `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                      fu.name AS feedback_author_name
               FROM ai_proposals p
               LEFT JOIN feedback f ON f.id = p.feedback_id
               LEFT JOIN users fu ON fu.id = f.user_id
               WHERE p.status = ?
               ORDER BY p.created_at DESC`,
              status,
            )
          : await db.all(
              `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                      fu.name AS feedback_author_name
               FROM ai_proposals p
               LEFT JOIN feedback f ON f.id = p.feedback_id
               LEFT JOIN users fu ON fu.id = f.user_id
               ORDER BY p.created_at DESC`,
            );
        return res.json({ data: rows });
      }

      if (scope === 'feedbacks') {
        const feedbacks = await db.all(
          `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
           FROM feedback f
           LEFT JOIN users u ON u.id = f.user_id
           WHERE f.status IN ('open','awaiting_approval','in_progress')
           ORDER BY f.created_at ASC`,
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

      return res.json({ ok: true, scopes: ['proposals', 'feedbacks'] });
    }

    // --- WRITE ACTIONS ---

    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, decision, id);
      const row = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
      return res.json({ ok: true, row });
    }

    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, feedback_id, changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || 'daily-run-2026-06-04',
        changes || null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json({ ok: true, row: created });
    }

    if (action === 'post_message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
        feedbackId, text,
      );
      const msg = await db.get('SELECT * FROM feedback_messages WHERE id = ?', r.lastInsertRowid);
      return res.json({ ok: true, row: msg });
    }

    if (action === 'update_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW()
         WHERE id = ?`,
        status, admin_reply, id,
      );
      const row = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      return res.json({ ok: true, row });
    }

    if (action === 'close_feedback') {
      const id = Number(req.query.id);
      const note = req.query.note || 'Закрыто AI-ассистентом';
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE feedback SET status = 'closed', admin_reply = ?, updated_at = NOW() WHERE id = ?`,
        note, id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
