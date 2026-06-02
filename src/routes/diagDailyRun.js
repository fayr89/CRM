// TEMP: ежедневный обход AI (сессия y1kiE). Снести отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr-y1kiE-6e3a9b2c';

function guard(req, res) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// Все операции — GET с action=... для совместимости с Vercel MCP (только GET).

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || 'get-proposals';

  try {
    // --- AI proposals ---
    if (action === 'get-proposals') {
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
         ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
                  p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows, total: rows.length });
    }

    if (action === 'post-proposal') {
      const { title, summary, category, risk, source, feedback_id } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const proposed_changes = req.query.proposed_changes
        ? JSON.parse(decodeURIComponent(req.query.proposed_changes))
        : null;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        String(title),
        String(summary),
        category || null,
        risk || 'medium',
        source || 'daily-run-2026-06-02',
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json(created);
    }

    if (action === 'patch-proposal') {
      const { id, decision, notes } = req.query;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', Number(id));
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision,
        notes || null,
        cur.id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', cur.id));
    }

    // --- Feedback ---
    if (action === 'get-feedback') {
      const status = req.query.status || null;
      const where = status ? 'WHERE f.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         ${where}
         ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1
                  WHEN 'awaiting_approval' THEN 2 ELSE 3 END),
                  f.created_at DESC`,
        ...params,
      );
      // Подгрузить треды (без вложений для компактности)
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        fb.messages = msgs;
      }
      return res.json({ data: rows, total: rows.length });
    }

    if (action === 'patch-feedback') {
      const { id, status, reply } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', Number(id));
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        newStatus,
        reply || null,
        cur.id,
      );
      return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
    }

    if (action === 'post-message') {
      const { feedback_id, text } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', Number(feedback_id));
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      // Найти первого admin-пользователя для user_id
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' AND active=true ORDER BY id LIMIT 1`);
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, ?, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
        fb.id,
        adminUser?.id || null,
        decodeURIComponent(String(text)),
      );
      return res.json(await db.get(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE id = ?`,
        r.lastInsertRowid,
      ));
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
