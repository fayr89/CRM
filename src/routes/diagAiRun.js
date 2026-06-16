// TEMP: ежедневный AI-обход. Сносить сразу после использования.
// GET /api/diag/daily-v27?secret=daily-2026-06-16-v27-q8r&action=...
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-16-v27-q8r';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

async function getAdminId() {
  const r = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  return r?.id || 1;
}

router.get('/daily-v27', async (req, res) => {
  const { action } = req.query;
  try {
    if (action === 'read_proposals') {
      const statuses = ['approved', 'revision', 'rejected', 'pending'];
      const result = {};
      for (const status of statuses) {
        const rows = await db.all(
          `SELECT p.id, p.feedback_id, p.title, p.summary, p.category, p.risk,
                  p.source, p.proposed_changes, p.status, p.admin_notes,
                  p.admin_decision_at, p.created_at, p.updated_at,
                  f.subject AS feedback_subject, f.status AS feedback_status
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           WHERE p.status = ? ORDER BY p.created_at DESC`,
          status,
        );
        for (const p of rows) {
          p.messages = await db.all(
            `SELECT id, user_id, user_name, role, text, created_at
             FROM ai_proposal_messages WHERE proposal_id = ?
             ORDER BY created_at ASC, id ASC`,
            p.id,
          );
        }
        result[status] = rows;
      }
      return res.json(result);
    }

    if (action === 'read_feedback') {
      const rows = await db.all(
        `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
                f.admin_reply, f.context, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      for (const fb of rows) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json(rows);
    }

    if (action === 'write') {
      const raw = req.query.data ? Buffer.from(req.query.data, 'base64').toString('utf8') : '{}';
      const d = JSON.parse(raw);
      const adminId = await getAdminId();

      if (d.op === 'done_proposal') {
        await db.run(
          `UPDATE ai_proposals SET status = 'done', admin_decision_by = ?,
           admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
          adminId, d.id,
        );
        return res.json({ ok: true, op: 'done_proposal', id: d.id });
      }

      if (d.op === 'post_proposal_msg') {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
          d.id, adminId, d.text,
        );
        return res.json({ ok: true, op: 'post_proposal_msg', id: d.id });
      }

      if (d.op === 'patch_feedback') {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', d.id);
        if (!cur) return res.status(404).json({ error: 'feedback not found' });
        const newStatus = d.status || cur.status;
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        if (justResolved) {
          await db.run(
            `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
             resolved_by = ?, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
            newStatus, d.admin_reply ?? null, adminId, d.id,
          );
        } else {
          await db.run(
            `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
             updated_at = NOW() WHERE id = ?`,
            newStatus, d.admin_reply ?? null, d.id,
          );
        }
        return res.json({ ok: true, op: 'patch_feedback', id: d.id, newStatus });
      }

      if (d.op === 'post_feedback_msg') {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
          d.id, adminId, d.text,
        );
        return res.json({ ok: true, op: 'post_feedback_msg', id: d.id });
      }

      if (d.op === 'create_proposal') {
        const r = await db.run(
          `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          d.feedback_id ?? null,
          d.title,
          d.summary,
          d.category ?? null,
          d.risk || 'medium',
          d.source ?? null,
          d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
        );
        return res.json({ ok: true, op: 'create_proposal', id: r.lastInsertRowid });
      }

      if (d.op === 'update_proposal') {
        await db.run(
          `UPDATE ai_proposals SET title = COALESCE(?, title), summary = COALESCE(?, summary),
           status = COALESCE(?, status), updated_at = NOW() WHERE id = ?`,
          d.title ?? null, d.summary ?? null, d.status ?? null, d.id,
        );
        return res.json({ ok: true, op: 'update_proposal', id: d.id });
      }

      return res.status(400).json({ error: `unknown op: ${d.op}` });
    }

    return res.json({ ok: true, actions: ['read_proposals', 'read_feedback', 'write'] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
