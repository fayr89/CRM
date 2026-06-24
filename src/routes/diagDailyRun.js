// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода обращений.
// Секрет в query ?secret= даёт обход auth. УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'v22_h4w8q2m6n1';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
}

router.get(
  '/',
  checkSecret,
  asyncHandler(async (req, res) => {
    const { action, status, id } = req.query;

    if (action === 'proposals') {
      const rows = status
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             WHERE p.status = $1
             ORDER BY p.created_at DESC LIMIT 100`,
            status,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
             FROM ai_proposals p
             LEFT JOIN feedback f ON f.id = p.feedback_id
             ORDER BY p.created_at DESC LIMIT 100`,
          );
      return res.json({ data: rows });
    }

    if (action === 'proposal-messages') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC`,
        Number(id),
      );
      return res.json({ data: rows });
    }

    if (action === 'feedback') {
      const rows = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
                f.created_at, f.updated_at, u.name AS author_name, u.email AS author_email
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC LIMIT 100`,
      );
      const result = [];
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, text, user_name, role, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC`,
          fb.id,
        );
        result.push({ ...fb, messages: msgs });
      }
      return res.json({ data: result });
    }

    return res.status(400).json({ error: 'unknown action' });
  }),
);

router.post(
  '/',
  checkSecret,
  asyncHandler(async (req, res) => {
    const { action } = req.body;

    if (action === 'create-proposal') {
      const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', NOW(), NOW())
         RETURNING *`,
        feedback_id || null, title, summary, category || 'feature', risk || 'medium',
        source || 'daily-run-2026-06-24', JSON.stringify(proposed_changes || []),
      );
      return res.json({ ok: true, proposal: r.rows[0] });
    }

    if (action === 'update-proposal') {
      const { id, status: newStatus } = req.body;
      if (!id || !newStatus) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`,
        newStatus, Number(id),
      );
      return res.json({ ok: true });
    }

    if (action === 'post-proposal-message') {
      const { proposal_id, text, user_name } = req.body;
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id, text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, text, user_name, created_at)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        Number(proposal_id), text, user_name || 'AI ассистент',
      );
      return res.json({ ok: true, message: r.rows[0] });
    }

    if (action === 'post-feedback-message') {
      const { feedback_id, text, user_name } = req.body;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id, text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, text, user_name, role, created_at)
         VALUES ($1, $2, $3, 'admin', NOW()) RETURNING *`,
        Number(feedback_id), text, user_name || 'AI ассистент',
      );
      return res.json({ ok: true, message: r.rows[0] });
    }

    if (action === 'update-feedback') {
      const { id, status: newStatus, admin_reply } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (newStatus && admin_reply !== undefined) {
        await db.run(
          `UPDATE feedback SET status = $1, admin_reply = $2, updated_at = NOW() WHERE id = $3`,
          newStatus, admin_reply, Number(id),
        );
      } else if (newStatus) {
        await db.run(`UPDATE feedback SET status = $1, updated_at = NOW() WHERE id = $2`, newStatus, Number(id));
      } else if (admin_reply !== undefined) {
        await db.run(`UPDATE feedback SET admin_reply = $1, updated_at = NOW() WHERE id = $2`, admin_reply, Number(id));
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  }),
);

export default router;
