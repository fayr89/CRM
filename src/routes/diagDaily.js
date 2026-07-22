// Временный диагностический эндпоинт для ежедневного обхода AI (v517).
// Анонимный, только агрегаты (+ дамп тредов при op=feedback-full). Секрет в query. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v517-9c2e41ab';

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
  if (op === 'proposals') {
    const rows = await db.all(
      `SELECT id, feedback_id, title, summary, category, risk, status, admin_notes, created_at, updated_at
       FROM ai_proposals WHERE status != 'done' ORDER BY created_at`,
    );
    return res.json({ proposals: rows });
  }
  if (op === 'feedback-full') {
    const rows = await db.all(
      `SELECT id, user_id, category, subject, message, status, admin_reply, rejected_reason,
              created_at, updated_at
       FROM feedback WHERE status IN ('open','awaiting_approval') ORDER BY created_at`,
    );
    const ids = rows.map((r) => r.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT feedback_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?) ORDER BY feedback_id, created_at`,
        ids,
      );
    }
    const byFeedback = {};
    for (const m of messages) {
      (byFeedback[m.feedback_id] ||= []).push(m);
    }
    return res.json({
      feedback: rows.map((r) => ({ ...r, thread: byFeedback[r.id] || [] })),
    });
  }
  return res.status(400).json({ error: 'unknown op' });
});

export default router;
