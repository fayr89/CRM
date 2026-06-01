// TEMP: diag-эндпоинт для AI-обхода 2026-06-01 (сессия CF5Ji).
// УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-dg7Yp3kXqN2wLmR8-CF5Ji';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-CF5Ji?secret=...&action=...
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const action = req.query.action || 'get_proposals';

  try {
    // --- Читать proposals ---
    if (action === 'get_proposals') {
      const status = req.query.status || null;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    // --- Читать feedback с тредами ---
    if (action === 'get_feedback') {
      const statusFilter = req.query.status || null;
      const where = statusFilter ? 'WHERE f.status = $1' : '';
      const params = statusFilter ? [statusFilter] : [];
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         ${where}
         ORDER BY f.created_at DESC`,
        ...params,
      );
      // Подтягиваем треды
      for (const fb of rows) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ data: rows });
    }

    // --- Обновить статус proposal ---
    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision; // done | approved | rejected | revision
      const notes = req.query.notes || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = COALESCE($2, admin_notes), updated_at = NOW() WHERE id = $3`,
        decision, notes, id,
      );
      const row = await db.get('SELECT * FROM ai_proposals WHERE id = $1', id);
      return res.json(row);
    }

    // --- Создать proposal ---
    if (action === 'post_proposal') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || `daily-run-2026-06-01`;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes || null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        proposed_changes ? proposed_changes : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    // --- Написать сообщение в тред ---
    if (action === 'post_message') {
      const feedback_id = Number(req.query.feedback_id);
      const text = req.query.text || '';
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = $1', feedback_id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         SELECT $1, id, 'AI ассистент', 'admin', $2 FROM users WHERE role = 'admin' ORDER BY id LIMIT 1
         RETURNING id`,
        feedback_id, text,
      );
      const msg = await db.get('SELECT * FROM feedback_messages WHERE id = $1', r.lastInsertRowid);
      return res.json(msg);
    }

    // --- Обновить статус feedback ---
    if (action === 'patch_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      const adminUser = await db.get('SELECT id FROM users WHERE role = $1 ORDER BY id LIMIT 1', 'admin');
      await db.run(
        `UPDATE feedback SET
           status = $1,
           admin_reply = COALESCE($2, admin_reply),
           resolved_by = CASE WHEN $3 THEN $4 ELSE resolved_by END,
           resolved_at = CASE WHEN $3 THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = $5`,
        newStatus,
        admin_reply,
        justResolved,
        adminUser?.id ?? null,
        id,
      );
      const row = await db.get('SELECT * FROM feedback WHERE id = $1', id);
      return res.json(row);
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
