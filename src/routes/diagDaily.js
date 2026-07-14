// Временный диагностический эндпоинт для ежедневного AI-обхода (daily-v331).
// Секрет через query. Снести отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-v331-7e2a9c4f';

router.get(
  '/daily-v331',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(404).end();
    const op = req.query.op || 'meta';

    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`
      );
      const lastProposal = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const lastFeedbackMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: lastProposal?.t,
        feedback_last_msg: lastFeedbackMsg?.t,
      });
    }

    if (op === 'get-feedback-summary') {
      const feedback = await db.all(
        `SELECT f.id, f.status, f.subject, f.updated_at,
                (SELECT json_build_object('user_name', m.user_name, 'created_at', m.created_at, 'text', LEFT(m.text, 120))
                 FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC LIMIT 1) AS last_msg
         FROM feedback f
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.id`
      );
      return res.json({ feedback });
    }

    if (op === 'proposals-list') {
      const status = String(req.query.status || 'pending');
      const rows = await db.all(
        `SELECT id, title, status, risk, feedback_id, updated_at FROM ai_proposals WHERE status = ? ORDER BY id`,
        [status]
      );
      return res.json({ rows });
    }

    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT user_name, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`,
        [id]
      );
      return res.json({ rows });
    }

    return res.status(400).json({ error: 'unknown op' });
  })
);

export default router;
