// Временный диагностический эндпоинт для ежедневного обхода AI (v568).
// Анонимный, только агрегаты + чтение/запись треда обращений и ai_proposals.
// Секрет в query. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v568-1a43cce4';
const decodeB64 = (s) => (s ? Buffer.from(String(s), 'base64').toString('utf8') : null);

router.get('/daily-v568', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';

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
    });
  }

  if (op === 'get-feedback-summary') {
    const rows = await db.all(
      `SELECT f.id, f.status, f.updated_at,
              (SELECT row_to_json(m) FROM (
                 SELECT user_name, role, text, created_at
                 FROM feedback_messages WHERE feedback_id = f.id
                 ORDER BY created_at DESC LIMIT 1
               ) m) AS last_msg
       FROM feedback f
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.id`,
    );
    return res.json({ feedback: rows });
  }

  if (op === 'feedback-full') {
    const rows = await db.all(
      `SELECT id, user_id, category, subject, message, status, admin_reply,
              created_at, updated_at
       FROM feedback WHERE status IN ('open','awaiting_approval') ORDER BY created_at`,
    );
    const ids = rows.map((r) => r.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT feedback_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?) ORDER BY feedback_id, created_at`,
        ids,
      );
    }
    const byFeedback = {};
    for (const m of messages) {
      (byFeedback[m.feedback_id] ||= []).push(m);
    }
    return res.json({
      feedback: rows.map((r) => ({ ...r, thread: byFeedback[r.id] || [] })),
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
    const id = Number(req.query.proposal_id);
    if (!id) return res.status(400).json({ error: 'proposal_id required' });
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      id,
    );
    return res.json({ messages: rows });
  }

  if (op === 'post-message') {
    const feedbackId = Number(req.query.feedback_id);
    const text = decodeB64(req.query.text);
    if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedbackId);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedbackId, text,
    );
    const created = await db.get(
      'SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE id = ?',
      r.lastInsertRowid,
    );
    return res.status(201).json(created);
  }

  if (op === 'patch-feedback') {
    const id = Number(req.query.feedback_id);
    const status = req.query.status ? String(req.query.status) : null;
    if (!id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    await db.run(
      `UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', id));
  }

  if (op === 'create-proposal') {
    const title = decodeB64(req.query.title);
    const summary = decodeB64(req.query.summary);
    const category = req.query.category ? String(req.query.category) : null;
    const risk = req.query.risk ? String(req.query.risk) : 'medium';
    const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const source = req.query.source ? String(req.query.source) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedbackId, title, summary, category, risk, source,
    );
    return res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (op === 'patch-proposal') {
    const id = Number(req.query.proposal_id);
    const status = req.query.status ? String(req.query.status) : null;
    if (!id || !status) return res.status(400).json({ error: 'proposal_id and status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', id));
  }

  return res.status(400).json({
    error: 'unknown op',
    allowed: ['meta', 'get-feedback-summary', 'feedback-full', 'list-proposals',
      'proposal-messages', 'post-message', 'patch-feedback', 'create-proposal', 'patch-proposal'],
  });
});

export default router;
