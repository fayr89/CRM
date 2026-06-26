// TEMP: ежедневный диагностический эндпоинт для AI-ассистента.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { ensureInitialized } from '../db.js';

const router = Router();
const DIAG_SECRET = 'ai-daily-2026-06-26-v4-k9mXpQ';

router.get('/daily-run-v4', async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    await ensureInitialized();

    // Все обращения (open + awaiting_approval + in_progress)
    const feedbackRows = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','in_progress','awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    // Треды для этих обращений
    const feedbackIds = feedbackRows.map(r => r.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }

    // Собираем треды по feedback_id
    const threadMap = {};
    for (const m of feedbackMessages) {
      if (!threadMap[m.feedback_id]) threadMap[m.feedback_id] = [];
      threadMap[m.feedback_id].push(m);
    }
    const feedback = feedbackRows.map(f => ({ ...f, thread: threadMap[f.id] || [] }));

    // AI-предложения — все статусы кроме done
    const proposals = await db.all(
      `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
              p.feedback_id, p.admin_notes, p.proposed_changes,
              p.created_at, p.updated_at, p.admin_decision_at,
              u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status != 'done'
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'pending' THEN 2 ELSE 3 END),
                p.created_at DESC
       LIMIT 50`,
    );

    // Треды для предложений
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT id, proposal_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
         ORDER BY created_at ASC, id ASC`,
      );
    }

    const propMsgMap = {};
    for (const m of proposalMessages) {
      if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
      propMsgMap[m.proposal_id].push(m);
    }
    const proposalsWithThreads = proposals.map(p => ({ ...p, thread: propMsgMap[p.id] || [] }));

    res.json({
      generated_at: new Date().toISOString(),
      feedback,
      proposals: proposalsWithThreads,
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
