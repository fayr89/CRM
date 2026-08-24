// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода (см. AI-DAILY.md).
// Секрет в query, только чтение агрегатов. Сносится отдельным коммитом сразу
// после использования — не должен задерживаться в проде.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v1283-0c0da819dd';

router.get('/feedback-full', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).end();
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsTotal = await db.get('SELECT COUNT(*)::int AS n FROM ai_proposals');
      const proposalsByStatus = await db.all(
        'SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status',
      );
      const feedbackByStatus = await db.all(
        'SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status',
      );
      const feedbackOpenCount = await db.get(
        "SELECT COUNT(*)::int AS n FROM feedback WHERE status IN ('open','awaiting_approval')",
      );
      const proposalsLastUpdate = await db.get('SELECT MAX(updated_at) AS t FROM ai_proposals');
      const feedbackLastMsg = await db.get('SELECT MAX(created_at) AS t FROM feedback_messages');
      res.json({
        proposals_total: proposalsTotal?.n || 0,
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map(r => [r.status, r.n])),
        feedback_open_count: feedbackOpenCount?.n || 0,
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
        server_now: new Date().toISOString(),
      });
      return;
    }
    if (op === 'list-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all('SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at ASC', status)
        : await db.all('SELECT * FROM ai_proposals ORDER BY created_at ASC');
      res.json({ data: rows });
      return;
    }
    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        'SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC',
        id,
      );
      res.json({ data: rows });
      return;
    }
    if (op === 'feedback-threads') {
      const status = req.query.status;
      const rows = status
        ? await db.all(
          `SELECT f.*, u.name AS user_name, u.email AS user_email
           FROM feedback f LEFT JOIN users u ON u.id = f.user_id
           WHERE f.status = ? ORDER BY f.created_at ASC`,
          status,
        )
        : await db.all(
          `SELECT f.*, u.name AS user_name, u.email AS user_email
           FROM feedback f LEFT JOIN users u ON u.id = f.user_id
           ORDER BY f.created_at ASC`,
        );
      const withMessages = await Promise.all(
        rows.map(async f => ({
          ...f,
          messages: await db.all(
            'SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC',
            f.id,
          ),
        })),
      );
      res.json({ data: withMessages });
      return;
    }
    if (op === 'check-user') {
      const email = req.query.email;
      const row = await db.get('SELECT id, email, active, updated_at FROM users WHERE email = ?', email);
      res.json({ data: row || null });
      return;
    }
    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
