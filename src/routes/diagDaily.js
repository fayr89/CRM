import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-v304-9d1e7b';

router.get('/daily-v304', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';
  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS ts FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS ts FROM feedback_messages`
      );
      const feedbackOpenCount = await db.get(
        `SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`
      );
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        proposals_last_update: proposalsLastUpdate.ts,
        feedback_last_msg: feedbackLastMsg.ts,
        feedback_open_count: feedbackOpenCount.n,
        proposals_total: proposalsTotal.n,
      });
    }
    if (op === 'get-feedback-summary') {
      const statuses = (req.query.status || 'open,awaiting_approval').split(',');
      const placeholders = statuses.map(() => '?').join(',');
      const rows = await db.all(
        `SELECT id, subject, status, updated_at FROM feedback WHERE status IN (${placeholders}) ORDER BY id`,
        ...statuses
      );
      const out = [];
      for (const f of rows) {
        const lastMsg = await db.get(
          `SELECT user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at DESC LIMIT 1`,
          f.id
        );
        out.push({
          id: f.id,
          subject: f.subject,
          status: f.status,
          updated_at: f.updated_at,
          last_msg: lastMsg
            ? { user_name: lastMsg.user_name, role: lastMsg.role, created_at: lastMsg.created_at, text: lastMsg.text.slice(0, 200) }
            : null,
        });
      }
      return res.json({ count: out.length, feedback: out });
    }
    if (op === 'get-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY id`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY id`);
      return res.json({ count: rows.length, proposals: rows });
    }
    if (op === 'get-proposal-messages') {
      const id = req.query.id;
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at`,
        id
      );
      return res.json({ count: rows.length, messages: rows });
    }
    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
