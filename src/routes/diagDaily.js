// Временный diag-эндпоинт для ежедневного обхода AI. Только GET, только
// агрегаты + чтение тредов открытых обращений. Секрет в query, не в auth-
// системе — сносится отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-v695-9c3e7f2b';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) return res.status(404).json({ error: 'not found' });
    const op = String(req.query.op || 'meta');

    if (op === 'meta') {
      const proposalsByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status`,
      );
      const feedbackByStatus = await db.all(
        `SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`,
      );
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
      const rows = await db.all(
        `SELECT id, feedback_id, title, status, risk, updated_at FROM ai_proposals
         WHERE status != 'done' ORDER BY updated_at DESC`,
      );
      return res.json({ data: rows });
    }

    if (op === 'get-feedback-summary') {
      const rows = await db.all(
        `SELECT f.id, f.subject, f.status, f.category, f.created_at,
                u.name AS author_name
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at ASC`,
      );
      const out = [];
      for (const f of rows) {
        const last = await db.get(
          `SELECT role, user_name, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          f.id,
        );
        out.push({ ...f, last_message: last || null });
      }
      return res.json({ data: out });
    }

    if (op === 'create_proposal') {
      const decode = (s) => {
        if (!s) return null;
        const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(b64, 'base64').toString('utf8');
      };
      const title = decode(req.query.title_b64);
      const summary = decode(req.query.summary_b64);
      if (!title || !summary) return res.status(400).json({ error: 'title_b64/summary_b64 required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        req.query.feedback_id ? Number(req.query.feedback_id) : null,
        title,
        summary,
        req.query.category ? String(req.query.category) : null,
        req.query.risk ? String(req.query.risk) : 'medium',
        req.query.source ? String(req.query.source) : 'daily-run-v695',
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
