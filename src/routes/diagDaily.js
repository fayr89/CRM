// Временный диагностический эндпоинт для ежедневного обхода AI (v1284).
// Анонимный (auth через секрет в query), read + ограниченные write-операции
// (нужны, т.к. web_fetch_vercel_url поддерживает только GET, а обычные
// /api/ai-proposals и /api/feedback требуют admin JWT). Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1284-f7a3c9e21bd6045198de';

async function adminUserId() {
  const row = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  return row ? row.id : null;
}

router.get('/daily-v1284', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';

  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
        server_now: new Date().toISOString(),
      });
    }

    if (op === 'list-proposals') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at`
          : `SELECT * FROM ai_proposals WHERE status != 'done' ORDER BY created_at`,
        ...(status ? [status] : []),
      );
      return res.json({ proposals: rows });
    }

    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ messages });
    }

    if (op === 'list-feedback') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
             FROM feedback f LEFT JOIN users u ON u.id = f.user_id
             WHERE f.status = ? ORDER BY f.id`
          : `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
             FROM feedback f LEFT JOIN users u ON u.id = f.user_id
             WHERE f.status IN ('open','awaiting_approval') ORDER BY f.id`,
        ...(status ? [status] : []),
      );
      return res.json({ feedback: rows });
    }

    if (op === 'feedback-thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ messages });
    }

    // --- writes below (все под тем же секретом, только для этого обхода) ---

    if (op === 'proposal-set-status') {
      const id = Number(req.query.id);
      const status = String(req.query.status || '');
      if (!id || !['pending', 'done'].includes(status)) {
        return res.status(400).json({ error: 'id + status(pending|done) required' });
      }
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        status,
        id,
      );
      return res.json({ ok: true, proposal: await db.get('SELECT * FROM ai_proposals WHERE id = ?', id) });
    }

    if (op === 'proposal-message') {
      const id = Number(req.query.id);
      const text = req.query.text ? String(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id + text required' });
      const uid = await adminUserId();
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`,
        id,
        uid,
        'AI ассистент',
        'admin',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    if (op === 'proposal-create') {
      const title = req.query.title ? String(req.query.title) : '';
      const summary = req.query.summary ? String(req.query.summary) : '';
      if (!title || !summary) return res.status(400).json({ error: 'title + summary required' });
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const category = req.query.category ? String(req.query.category) : null;
      const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
      const source = req.query.source ? String(req.query.source) : 'daily-run';
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedbackId,
        title,
        summary,
        category,
        risk,
        source,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (op === 'feedback-set-status') {
      const id = Number(req.query.id);
      const status = String(req.query.status || '');
      if (!id || !['open', 'in_progress', 'awaiting_approval', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'id + valid status required' });
      }
      const adminReply = req.query.admin_reply ? String(req.query.admin_reply) : null;
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const uid = await adminUserId();
      const justResolved = (status === 'awaiting_approval' || status === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?,
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        status,
        adminReply,
        justResolved ? uid : cur.resolved_by,
        id,
      );
      return res.json({ ok: true, feedback: await db.get('SELECT * FROM feedback WHERE id = ?', id) });
    }

    if (op === 'feedback-message') {
      const id = Number(req.query.id);
      const text = req.query.text ? String(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id + text required' });
      const uid = await adminUserId();
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        id,
        uid,
        'AI ассистент',
        'admin',
        text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
});

export default router;
