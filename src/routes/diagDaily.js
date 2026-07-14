import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'daily-v341-f2c8d1';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(404).json({ error: 'not found' });
  const op = req.query.op || 'meta';

  try {
    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS c FROM ai_proposals GROUP BY status`
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS c FROM feedback GROUP BY status`
      );
      const proposalsLastUpdate = await db.get(
        `SELECT MAX(updated_at) AS t FROM ai_proposals`
      );
      const feedbackLastMsg = await db.get(
        `SELECT MAX(created_at) AS t FROM feedback_messages`
      );
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.c])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.c])),
        proposals_last_update: proposalsLastUpdate?.t,
        feedback_last_msg: feedbackLastMsg?.t,
      });
    }

    if (op === 'get-feedback-summary') {
      const rows = await db.all(`
        SELECT f.id, f.status, f.subject, f.updated_at,
          (SELECT jsonb_build_object('user_name', m.user_name, 'role', m.role, 'created_at', m.created_at, 'text', LEFT(m.text, 200))
           FROM feedback_messages m WHERE m.feedback_id = f.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
        FROM feedback f
        WHERE f.status IN ('open', 'awaiting_approval')
        ORDER BY f.id ASC
      `);
      return res.json({ rows });
    }

    if (op === 'get-feedback') {
      const rows = await db.all(`SELECT * FROM feedback WHERE status IN ('open','awaiting_approval') ORDER BY id ASC`);
      const withMsgs = [];
      for (const f of rows) {
        const messages = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          f.id
        );
        withMsgs.push({ ...f, messages });
      }
      return res.json({ rows: withMsgs });
    }

    if (op === 'proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY id ASC`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY id ASC`);
      return res.json({ rows });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
