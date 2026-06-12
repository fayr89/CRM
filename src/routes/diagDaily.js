// TEMP — временный диаг-эндпоинт для ежедневного AI-обхода.
// Сносится сразу после использования в том же round.
// GET /api/diag/daily-full?s=DAILY_RUN_2026_06_12_X7mR
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'DAILY_RUN_2026_06_12_X7mR';

router.get('/daily-full', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // 1. ai_proposals — все кроме done
    const proposals = await db.all(
      `SELECT id, title, summary, category, risk, source, status, admin_notes,
              feedback_id, proposed_changes, created_at, updated_at
       FROM ai_proposals WHERE status != 'done'
       ORDER BY created_at DESC`,
    );

    // 2. Сообщения для каждого proposal
    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    // 3. Feedback — open + awaiting_approval
    const feedbacks = await db.all(
      `SELECT f.id, f.user_name, f.email, f.category, f.subject, f.message,
              f.status, f.admin_reply, f.created_at, f.updated_at
       FROM feedback f
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    // 4. Сообщения тредов для каждого feedback
    const feedbackMessages = {};
    for (const f of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_name, role, message, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC`,
        f.id,
      );
      feedbackMessages[f.id] = msgs;
    }

    // 5. Последние коммиты (для контекста)
    res.json({ proposals, proposalMessages, feedbacks, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
