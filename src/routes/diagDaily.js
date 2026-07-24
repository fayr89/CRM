// Временный диагностический эндпоинт для ежедневного обхода AI (v570).
// Анонимный, только агрегаты + чтение/запись треда обращений и ai_proposals.
// Секрет в query. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v570-281e7ce1';
const decodeB64 = (s) => (s ? Buffer.from(String(s), 'base64').toString('utf8') : null);

router.get('/daily-v570', async (req, res) => {
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

  return res.status(400).json({ error: 'unknown op' });
});

export default router;
