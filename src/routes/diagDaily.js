// Временный diag-эндпоинт для ежедневного обхода AI (v866). Только GET, только
// агрегаты + чтение тредов — секрет в query, не в auth-системе;
// сносится отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-v866-9f3c2a71e8d0b654';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(404).json({ error: 'not found' });
    const op = String(req.query.op || 'meta');

    if (op === 'meta') {
      const proposalsByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`);
      const feedbackByStatus = await db.all(`SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`);
      const lastMsg = await db.get(`SELECT MAX(created_at) AS t FROM feedback_messages`);
      const lastProposalUpdate = await db.get(`SELECT MAX(updated_at) AS t FROM ai_proposals`);
      return res.json({
        proposals_by_status: Object.fromEntries(proposalsByStatus.map((r) => [r.status, r.n])),
        feedback_by_status: Object.fromEntries(feedbackByStatus.map((r) => [r.status, r.n])),
        feedback_last_msg: lastMsg?.t || null,
        proposals_last_update: lastProposalUpdate?.t || null,
      });
    }

    if (op === 'list-proposals') {
      const status = req.query.status ? String(req.query.status) : null;
      const rows = await db.all(
        status
          ? `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals WHERE status = ? ORDER BY updated_at DESC`
          : `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals WHERE status != 'done' ORDER BY updated_at DESC`,
        ...(status ? [status] : []),
      );
      return res.json({ data: rows });
    }

    if (op === 'get-feedback-summary') {
      const statuses = String(req.query.status || 'open,awaiting_approval').split(',');
      const rows = await db.all(
        `SELECT f.id, f.subject, f.status, f.category, f.created_at, u.name AS author_name
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status = ANY(?) ORDER BY f.created_at ASC`,
        statuses,
      );
      const out = [];
      for (const f of rows) {
        const last = await db.get(
          `SELECT role, user_name, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          f.id,
        );
        out.push({ ...f, last_message: last || null });
      }
      return res.json({ data: out });
    }

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
