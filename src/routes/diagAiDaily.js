// ВРЕМЕННЫЙ эндпоинт для AI ежедневного обхода обращений.
// Удалить после завершения обхода отдельным коммитом.
// GET /api/diag/ai-daily?secret=X&action=...
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const DIAG_SECRET = 'f8e2b1c7d4a9';

router.use((req, res, next) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { action, id, status, decision, text, title, summary, category, risk, source,
      feedback_id, changes, admin_reply } = req.query;

    // ──────────────────────────────────────────────────
    // READ: ai-proposals list
    if (action === 'get-proposals') {
      const where = status ? 'WHERE status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                fu.name AS feedback_author_name, fu.email AS feedback_author_email
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    // READ: ai-proposal messages
    if (action === 'get-proposal-messages') {
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC, id ASC`,
        Number(id),
      );
      const proposal = await db.get('SELECT id, title, status, admin_notes FROM ai_proposals WHERE id = $1', Number(id));
      return res.json({ proposal, messages: rows });
    }

    // READ: all open+awaiting_approval feedback with message threads
    if (action === 'get-feedback-full') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      const result = [];
      for (const row of rows) {
        const messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
          row.id,
        );
        result.push({ ...row, messages });
      }
      return res.json({ data: result, total: result.length });
    }

    // WRITE: update ai-proposal status
    if (action === 'update-proposal') {
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      const adminUserId = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_decision_by = $2, admin_decision_at = NOW(), updated_at = NOW() WHERE id = $3`,
        decision, adminUserId?.id ?? null, Number(id),
      );
      const updated = await db.get('SELECT * FROM ai_proposals WHERE id = $1', Number(id));
      return res.json({ ok: true, proposal: updated });
    }

    // WRITE: create ai-proposal
    if (action === 'create-proposal') {
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      let parsedChanges = null;
      if (changes) {
        try { parsedChanges = JSON.parse(changes); } catch { parsedChanges = null; }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        String(title),
        String(summary),
        category ?? 'feature',
        risk ?? 'medium',
        source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
        parsedChanges ? JSON.stringify(parsedChanges) : null,
      );
      const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.json({ ok: true, proposal: created });
    }

    // WRITE: post message to ai-proposal thread
    if (action === 'post-proposal-msg') {
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, $2, 'AI ассистент', 'admin', $3) RETURNING id, created_at`,
        Number(id), adminUser?.id ?? null, String(text),
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    // WRITE: post message to feedback thread
    if (action === 'post-feedback-msg') {
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES ($1, $2, 'AI ассистент', 'admin', $3) RETURNING id, created_at`,
        Number(id), adminUser?.id ?? null, String(text),
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    // WRITE: update feedback status / admin_reply
    if (action === 'update-feedback') {
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
      const cur = await db.get('SELECT * FROM feedback WHERE id = $1', Number(id));
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const isResolving = ['closed', 'awaiting_approval'].includes(status);
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply),
         resolved_by = CASE WHEN $3 THEN $4 ELSE resolved_by END,
         resolved_at = CASE WHEN $5 THEN NOW() ELSE resolved_at END,
         updated_at = NOW()
         WHERE id = $6`,
        status,
        admin_reply ? String(admin_reply) : null,
        isResolving, adminUser?.id ?? null,
        isResolving,
        Number(id),
      );
      const updated = await db.get('SELECT * FROM feedback WHERE id = $1', Number(id));
      return res.json({ ok: true, feedback: updated });
    }

    return res.status(400).json({ error: 'unknown action', available_actions: [
      'get-proposals', 'get-proposal-messages', 'get-feedback-full',
      'update-proposal', 'create-proposal', 'post-proposal-msg',
      'post-feedback-msg', 'update-feedback',
    ] });
  }),
);

export default router;
