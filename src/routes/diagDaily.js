// TEMP — diag для ежедневного AI-обхода 2026-06-16.
// Снести сразу после использования отдельным коммитом.
// GET /api/diag/daily?s=dr44run9x2
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr44run9x2';

router.get('/', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    // ai_proposals: все кроме done
    const proposals = await db.all(
      `SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
              p.feedback_id, p.admin_notes, p.proposed_changes,
              p.created_at, p.updated_at, p.admin_decision_at,
              u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status != 'done'
       ORDER BY p.status, p.created_at DESC`,
    );

    // threads для каждого proposal
    const proposalIds = proposals.map((p) => p.id);
    const allPropMsgs = proposalIds.length
      ? await db.all(
          `SELECT proposal_id, id, user_name, role, text, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ANY(?::int[])
           ORDER BY proposal_id, created_at ASC, id ASC`,
          `{${proposalIds.join(',')}}`,
        )
      : [];
    const propMsgMap = {};
    for (const m of allPropMsgs) {
      if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
      propMsgMap[m.proposal_id].push(m);
    }
    const proposalsWithThreads = proposals.map((p) => ({
      ...p,
      thread: propMsgMap[p.id] || [],
    }));

    // feedback: open и awaiting_approval
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS author_name, u.email AS author_email, u.role AS author_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at ASC`,
    );

    // threads для каждого feedback (без base64 вложений)
    const feedbackIds = feedbacks.map((f) => f.id);
    const allFbMsgs = feedbackIds.length
      ? await db.all(
          `SELECT fm.feedback_id, fm.id, fm.user_name, fm.role, fm.text, fm.created_at
           FROM feedback_messages fm
           WHERE fm.feedback_id = ANY(?::int[])
           ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`,
          `{${feedbackIds.join(',')}}`,
        )
      : [];
    const fbMsgMap = {};
    for (const m of allFbMsgs) {
      if (!fbMsgMap[m.feedback_id]) fbMsgMap[m.feedback_id] = [];
      fbMsgMap[m.feedback_id].push(m);
    }
    const feedbacksWithThreads = feedbacks.map((f) => ({
      ...f,
      thread: fbMsgMap[f.id] || [],
    }));

    res.json({
      ts: new Date().toISOString(),
      proposals: proposalsWithThreads,
      feedbacks: feedbacksWithThreads,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
