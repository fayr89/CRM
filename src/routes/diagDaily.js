// Временный диагностический эндпоинт для ежедневного обхода AI (v459).
// Анонимный, только агрегаты, секрет в query. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v459-7c14ed2a';

router.get('/feedback-full', async (req, res) => {
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
  return res.status(400).json({ error: 'unknown op' });
});

export default router;
