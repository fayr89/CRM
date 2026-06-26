// ВРЕМЕННЫЙ diag-эндпоинт для AI-обхода 2026-06-26-v14. УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-26-v14-k8pzx';

router.get('/daily-read-v14', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // Proposals by status
    const approved = await db.all(`SELECT * FROM ai_proposals WHERE status='approved' ORDER BY updated_at DESC`);
    const revision = await db.all(`SELECT * FROM ai_proposals WHERE status='revision' ORDER BY updated_at DESC`);
    const rejected = await db.all(`SELECT * FROM ai_proposals WHERE status='rejected' ORDER BY updated_at DESC LIMIT 20`);
    const pending  = await db.all(`SELECT * FROM ai_proposals WHERE status='pending'  ORDER BY updated_at DESC LIMIT 30`);

    // Messages for all proposals we'll look at
    const allProposalIds = [...approved, ...revision, ...rejected, ...pending].map(p => p.id);
    const proposalMessages = {};
    for (const pid of allProposalIds) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`, pid);
      if (msgs.length) proposalMessages[pid] = msgs;
    }

    // Feedback: open and awaiting_approval with author info
    const feedback = await db.all(
      `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
              f.admin_reply, f.context, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at ASC`
    );

    // Messages for each feedback
    const feedbackWithThreads = [];
    for (const fb of feedback) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`, fb.id);
      feedbackWithThreads.push({ ...fb, messages: msgs });
    }

    res.json({
      run: 'daily-2026-06-26-v14',
      proposals: { approved, revision, rejected, pending },
      proposalMessages,
      feedback: feedbackWithThreads,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
