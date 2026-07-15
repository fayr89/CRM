// ВРЕМЕННЫЙ diag-эндпоинт для ежедневного AI-обхода (см. AI-DAILY.md).
// Одноразовый секрет в query, только GET, снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ca1d8270acee663c7cf3610c2b8f9495';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map(r => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map(r => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate?.t || null,
        feedback_last_msg: feedbackLastMsg?.t || null,
      });
    }
    if (op === 'proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY id`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY id`);
      return res.json(rows);
    }
    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`,
        id
      );
      return res.json(rows);
    }
    if (op === 'get-feedback-summary') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT row_to_json(m) FROM (
                   SELECT user_name, role, text, created_at
                   FROM feedback_messages
                   WHERE feedback_id = f.id
                   ORDER BY created_at DESC LIMIT 1
                 ) m) AS last_message
         FROM feedback f
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.id`
      );
      return res.json(rows);
    }
    if (op === 'get-feedback') {
      const id = Number(req.query.id);
      const feedback = await db.get(`SELECT * FROM feedback WHERE id = ?`, id);
      const messages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at`,
        id
      );
      return res.json({ feedback, messages });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
