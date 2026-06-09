// TEMP: AI daily-run diag v43. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '9c5b2f8e3a6d1c4e7f9a2b5d8c1e4f7a';

function b64(s) {
  return s ? Buffer.from(s, 'base64').toString('utf8') : null;
}

router.get(
  '/run',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const action = req.query.action || 'list_feedback';

    // --- ai_proposals ---
    if (action === 'list_proposals') {
      const status = req.query.status;
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
      return res.json({ data: rows, count: rows.length });
    }

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

    if (action === 'create_proposal') {
      const raw = req.query.data;
      if (!raw) return res.status(400).json({ error: 'data required' });
      const data = JSON.parse(b64(raw));
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
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.status(201).json(created);
    }

    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision,
        id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (action === 'post_proposal_message') {
      const id = Number(req.query.id);
      const text = b64(req.query.text);
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        admin?.id ?? null,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- feedback ---
    if (action === 'list_feedback') {
      const statuses = (req.query.statuses || 'open,awaiting_approval').split(',');
      const placeholders = statuses.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${placeholders})
         ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'awaiting_approval' THEN 1 ELSE 2 END),
                  f.created_at DESC`,
        ...statuses,
      );
      return res.json({ data: rows, count: rows.length });
    }

    if (action === 'feedback_messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (action === 'post_feedback_message') {
      const id = Number(req.query.id);
      const text = b64(req.query.text);
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        admin?.id ?? null,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const adminReply = req.query.admin_reply ? b64(req.query.admin_reply) : null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status,
        adminReply,
        id,
      );
      return res.json(await db.get('SELECT id, status, admin_reply, updated_at FROM feedback WHERE id = ?', id));
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }),
);

export default router;
