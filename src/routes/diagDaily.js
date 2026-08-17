// Временный диагностический эндпоинт для ежедневного обхода AI (v1096).
// Анонимный (auth через секрет в query), только GET (тул web_fetch_vercel_url
// не умеет в POST). Снести сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1096-3f7c9a1e5b02d84f7c19';
const AI_NAME = 'AI ассистент';
const decodeB64 = (s) => (s ? Buffer.from(String(s), 'base64').toString('utf8') : null);

router.get('/daily-v1096', async (req, res) => {
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

    if (op === 'check-user') {
      const email = req.query.email ? String(req.query.email) : null;
      if (!email) return res.status(400).json({ error: 'email required' });
      const row = await db.get(
        `SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ user: row || null });
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

    if (op === 'post-feedback-message') {
      const id = Number(req.query.id);
      const text = decodeB64(req.query.text) || (req.query.text ? String(req.query.text) : '');
      const status = req.query.status ? String(req.query.status) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id, status FROM feedback WHERE id = ?', id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        id,
        AI_NAME,
        text,
      );
      if (status && ['open', 'in_progress', 'awaiting_approval', 'closed'].includes(status)) {
        const justResolved = (status === 'awaiting_approval' || status === 'closed')
          && fb.status !== 'awaiting_approval' && fb.status !== 'closed';
        await db.run(
          `UPDATE feedback SET status = ?, updated_at = NOW()${justResolved ? ', resolved_at = NOW()' : ''}
           WHERE id = ?`,
          status,
          id,
        );
      }
      return res.json({ ok: true });
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

    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ messages });
    }

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision ? String(req.query.decision) : null;
      const notes = decodeB64(req.query.notes);
      if (!id || !['approved', 'rejected', 'revision', 'done', 'pending'].includes(decision)) {
        return res.status(400).json({ error: 'id and valid decision required' });
      }
      const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'proposal not found' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW()
         WHERE id = ?`,
        decision,
        notes,
        id,
      );
      return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
    }

    if (op === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = decodeB64(req.query.text) || (req.query.text ? String(req.query.text) : '');
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const prop = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!prop) return res.status(404).json({ error: 'proposal not found' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        id,
        AI_NAME,
        text,
      );
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const title = decodeB64(req.query.title);
      const summary = decodeB64(req.query.summary);
      const category = req.query.category ? String(req.query.category) : null;
      const risk = req.query.risk ? String(req.query.risk) : 'medium';
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const source = req.query.source ? String(req.query.source) : 'daily-run-2026-08-17-v1096';
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required (base64)' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending') RETURNING id`,
        feedbackId, title, summary, category, risk, source,
      );
      return res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
    }

    if (op === 'get-app-setting') {
      const key = req.query.setting ? String(req.query.setting) : null;
      if (!key) return res.status(400).json({ error: 'setting required' });
      const row = await db
        .get(`SELECT value, updated_by, updated_at FROM app_settings WHERE key = ?`, key)
        .catch(() => null);
      return res.json({ key, row: row || null });
    }

    return res.status(400).json({
      error: 'unknown op',
      ops: ['meta', 'check-user', 'list-feedback', 'feedback-thread', 'post-feedback-message',
        'list-proposals', 'proposal-thread', 'patch-proposal', 'post-proposal-message',
        'create-proposal', 'get-app-setting'],
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
