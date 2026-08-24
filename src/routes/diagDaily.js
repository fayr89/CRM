// Временный диагностический эндпоинт для ежедневного обхода AI (v1264).
// Анонимный (auth через секрет в query), только GET, только чтение.
// Снести сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v1264-2e6f1a8c4b7d9053a1e8c4f6b2a9d735';

router.get('/daily-v1264', async (req, res) => {
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
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      const proposalsLastUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const feedbackLastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const feedbackOpenCount = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status IN ('open','awaiting_approval')`);
      return res.json({
        proposals_total: proposalsTotal?.n,
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        feedback_open_count: feedbackOpenCount?.n,
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

    if (op === 'check-user') {
      const email = req.query.email ? String(req.query.email) : null;
      if (!email) return res.status(400).json({ error: 'email required' });
      const row = await db.get(
        `SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE email = ?`,
        email,
      );
      return res.json({ user: row || null });
    }

    if (op === 'feedback-full') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval') ORDER BY f.id`,
      );
      const ids = rows.map((r) => r.id);
      const messages = ids.length
        ? await db.all(
            `SELECT id, feedback_id, user_id, user_name, role, text, created_at
             FROM feedback_messages WHERE feedback_id = ANY(?) ORDER BY feedback_id, created_at ASC, id ASC`,
            ids,
          )
        : [];
      return res.json({ feedback: rows, messages });
    }

    return res.status(400).json({
      error: 'unknown op',
      ops: ['meta', 'list-proposals', 'check-user', 'feedback-full'],
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
