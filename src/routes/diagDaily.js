// ВРЕМЕННЫЙ диагностический роут для ежедневного обхода AI (v1310).
// Секрет в query, только агрегаты/чтение + узкие write-операции для обхода.
// Снести отдельным коммитом сразу после использования (см. CLAUDE.md/AI-DAILY.md).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v1310-9d47b1e6c3a2';

router.use((req, res, next) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const op = req.query.op || 'meta';

    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      const feedbackOpenCount = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`);
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(GREATEST(updated_at, COALESCE(admin_decision_at, updated_at))) AS t FROM ai_proposals`,
      );
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const proposalsMsgLast = await db.get(`SELECT MAX(created_at) AS t FROM ai_proposal_messages`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_total: proposalsTotal?.n || 0,
        feedback_open_count: feedbackOpenCount?.n || 0,
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
        proposals_msg_last: proposalsMsgLast?.t || null,
        server_now: new Date().toISOString(),
      });
    }

    if (op === 'list-proposals') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at ASC`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY created_at ASC`);
      return res.json({ data: rows });
    }

    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (op === 'list-feedback') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = status
        ? await db.all(
          `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
           FROM feedback f LEFT JOIN users u ON u.id = f.user_id
           WHERE f.status = ? ORDER BY f.created_at ASC`,
          status,
        )
        : await db.all(
          `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
           FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at ASC`,
        );
      return res.json({ data: rows });
    }

    if (op === 'search-feedback') {
      const q = String(req.query.q || '');
      if (!q) return res.status(400).json({ error: 'q required' });
      const rows = await db.all(
        `SELECT f.id, f.subject, f.message, f.status, f.created_at
         FROM feedback f WHERE f.subject ILIKE ? OR f.message ILIKE ?
         ORDER BY f.created_at DESC LIMIT 30`,
        `%${q}%`,
        `%${q}%`,
      );
      return res.json({ data: rows });
    }

    if (op === 'feedback-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages
         WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
