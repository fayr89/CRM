// ВРЕМЕННЫЙ diag-эндпоинт для ежедневного обхода AI (v294). Сносится отдельным
// коммитом сразу после использования. Секрет — одноразовый query-параметр.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'v294-9f2a7c1e';

router.get('/daily-v294', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(404).json({ error: 'not found' });
  try {
    const op = req.query.op || 'meta';
    if (op === 'meta') {
      const proposalsTotal = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals`);
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackOpen = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status = 'open'`);
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
      const lastProposal = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      const lastFeedbackMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      res.json({
        proposals_total: proposalsTotal?.n || 0,
        proposals_by_status: proposalsByStatus,
        feedback_open_count: feedbackOpen?.n || 0,
        feedback_by_status: feedbackByStatus,
        proposals_last_update: lastProposal?.t || null,
        feedback_last_msg: lastFeedbackMsg?.t || null,
      });
      return;
    }
    if (op === 'get-proposals') {
      const status = req.query.status;
      const rows = status
        ? await db.all(`SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at DESC`, status)
        : await db.all(`SELECT * FROM ai_proposals ORDER BY created_at DESC`);
      res.json(rows);
      return;
    }
    if (op === 'get-proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC`,
        id,
      );
      res.json(rows);
      return;
    }
    if (op === 'get-feedback') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const rows = await db.all(
        `SELECT f.*, u.name AS author_name FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status = ANY(?) ORDER BY f.updated_at DESC`,
        statuses,
      );
      const out = [];
      for (const f of rows) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at ASC`,
          f.id,
        );
        out.push({ ...f, messages: msgs });
      }
      res.json(out);
      return;
    }
    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

export default router;
