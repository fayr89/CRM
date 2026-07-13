// Временный диагностический эндпоинт для ежедневного обхода AI (v321).
// СНЕСТИ отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v321-7e2b9d';

router.get('/daily-v321', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  try {
    const op = req.query.op || 'meta';
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS ts FROM ai_proposals`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS ts FROM feedback_messages`,
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.ts || null,
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        feedback_last_msg: feedbackLastMsg?.ts || null,
      });
    }
    if (op === 'get-feedback-summary') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const placeholders = statuses.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.category, f.updated_at,
                u.name AS author_name
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN (${placeholders})
         ORDER BY f.id ASC`,
        ...statuses,
      );
      const result = [];
      for (const f of rows) {
        const lastMsg = await db.get(
          `SELECT user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          f.id,
        );
        result.push({
          id: f.id,
          status: f.status,
          subject: f.subject,
          category: f.category,
          updated_at: f.updated_at,
          author_name: f.author_name,
          last_msg: lastMsg
            ? { user_name: lastMsg.user_name, role: lastMsg.role, created_at: lastMsg.created_at, text_preview: String(lastMsg.text).slice(0, 120) }
            : null,
        });
      }
      return res.json({ data: result });
    }
    if (op === 'get-proposals') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY id ASC`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY id ASC`);
      return res.json({ data: rows });
    }
    if (op === 'get-proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
});

export default router;
