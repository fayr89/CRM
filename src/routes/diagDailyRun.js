// Временный диагностический эндпоинт для AI-ежедневного обхода.
// УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ — не оставлять в проде!
// Secret: b4k9m2p7r1s8
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'b4k9m2p7r1s8';

router.get('/', asyncHandler(async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const op = req.query.op || 'read_all';

  if (op === 'read_all') {
    const proposals = await db.all(
      `SELECT * FROM ai_proposals WHERE status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END),
       created_at DESC`,
    );
    const propIds = proposals.map((p) => p.id);
    const propMessages = propIds.length
      ? await db.all(
          `SELECT * FROM ai_proposal_messages WHERE proposal_id IN (${propIds.join(',')})
           ORDER BY created_at ASC, id ASC`,
        )
      : [];
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
    );
    const fbMessages = await db.all(
      `SELECT * FROM feedback_messages
       WHERE feedback_id IN (SELECT id FROM feedback WHERE status IN ('open','awaiting_approval'))
       ORDER BY created_at ASC, id ASC`,
    );
    return res.json({ proposals, propMessages, feedbacks, fbMessages });
  }

  if (op === 'mark_proposal_done') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id);
    return res.json({ ok: true, id });
  }

  if (op === 'update_proposal') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const status = req.query.status;
    const summary = req.query.summary;
    if (status) await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, status, id);
    if (summary) await db.run(`UPDATE ai_proposals SET summary = ?, updated_at = NOW() WHERE id = ?`, summary, id);
    return res.json({ ok: true, id });
  }

  if (op === 'post_feedback_msg') {
    const feedback_id = Number(req.query.feedback_id);
    const text = req.query.text;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.json({ ok: true, feedback_id, msg_id: r.lastInsertRowid });
  }

  if (op === 'update_feedback') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const status = req.query.status || null;
    const admin_reply = req.query.admin_reply || null;
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status, admin_reply, id,
    );
    return res.json({ ok: true, id });
  }

  if (op === 'create_proposal') {
    const { title, summary, category, risk, source, feedback_id } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title, summary,
      category || 'feature',
      risk || 'medium',
      source || 'daily-run-2026-06-18',
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'post_proposal_msg') {
    const proposal_id = Number(req.query.proposal_id);
    const text = req.query.text;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      proposal_id, text,
    );
    return res.json({ ok: true, proposal_id, msg_id: r.lastInsertRowid });
  }

  if (op === 'close_feedback') {
    const id = Number(req.query.id);
    const note = req.query.note || 'Закрыто AI-ассистентом';
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE feedback SET status = 'closed', admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      note, id,
    );
    return res.json({ ok: true, id });
  }

  return res.status(400).json({ error: 'unknown op: ' + op });
}));

export default router;
