// Временный диагностический эндпоинт для ежедневного обхода AI (v623).
// Анонимный (auth через секрет в query), только GET (тул web_fetch_vercel_url
// не умеет в POST). Снести сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v623-db2aaa0d';
const AI_NAME = 'AI ассистент';

router.get('/daily-v623', async (req, res) => {
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
      });
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

    // Ответ автору в тред + опционально смена статуса обращения.
    if (op === 'post-feedback-message') {
      const id = Number(req.query.id);
      const text = req.query.text ? String(req.query.text) : '';
      const status = req.query.status ? String(req.query.status) : null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        id,
        AI_NAME,
        text,
      );
      if (status && ['open', 'in_progress', 'awaiting_approval', 'closed'].includes(status)) {
        const cur = await db.get('SELECT status FROM feedback WHERE id = ?', id);
        const justResolved = (status === 'awaiting_approval' || status === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
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
      const notes = req.query.notes ? String(req.query.notes) : null;
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
      return res.json({ ok: true });
    }

    if (op === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = req.query.text ? String(req.query.text) : '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'proposal not found' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?)`,
        id,
        AI_NAME,
        text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
