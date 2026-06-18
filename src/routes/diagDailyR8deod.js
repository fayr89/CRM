// TEMPORARY: AI ежедневный диаг-обход 2026-06-18. УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ.
// Token: r8deod
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'r8deod';

function auth(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

// GET ?s=r8deod&op=proposals[&status=approved|revision|rejected|pending]
// GET ?s=r8deod&op=proposal_messages&id=X
// GET ?s=r8deod&op=feedback  (all open/awaiting_approval with threads)
// GET ?s=r8deod&op=exec&d=<base64 JSON>  (write operation)
//   d.action: proposal.patch, proposal.create, proposal.message, feedback.patch, feedback.message
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const op = req.query.op || 'help';

    // ── READ: ai_proposals по статусу ─────────────────────────────────
    if (op === 'proposals') {
      const status = req.query.status;
      const rows = await db.all(
        `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                p.status, p.admin_notes, p.feedback_id, p.proposed_changes,
                p.created_at, p.updated_at, p.admin_decision_at,
                f.subject AS feedback_subject, f.status AS feedback_status
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${status ? 'WHERE p.status = ?' : ''}
         ORDER BY p.created_at DESC`,
        ...(status ? [status] : []),
      );
      return res.json({ data: rows, total: rows.length });
    }

    // ── READ: тред сообщений одного proposal ─────────────────────────
    if (op === 'proposal_messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // ── READ: feedback open/awaiting_approval с тредами ──────────────
    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
      );
      // Подгружаем треды для каждого обращения
      const ids = rows.map((r) => r.id);
      const messages = ids.length
        ? await db.all(
            `SELECT feedback_id, id, user_name, role, text, created_at
             FROM feedback_messages
             WHERE feedback_id = ANY(?::int[])
             ORDER BY created_at ASC, id ASC`,
            '{' + ids.join(',') + '}',
          )
        : [];
      const threadMap = {};
      for (const m of messages) {
        if (!threadMap[m.feedback_id]) threadMap[m.feedback_id] = [];
        threadMap[m.feedback_id].push(m);
      }
      return res.json({
        data: rows.map((r) => ({ ...r, thread: threadMap[r.id] || [] })),
        total: rows.length,
      });
    }

    // ── WRITE: выполнить операцию ─────────────────────────────────────
    if (op === 'exec') {
      const raw = req.query.d;
      if (!raw) return res.status(400).json({ error: 'd required' });
      let payload;
      try {
        payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'invalid d (must be base64 JSON)' });
      }
      const { action } = payload;

      // proposal.patch: { action, id, decision, notes? }
      if (action === 'proposal.patch') {
        const { id, decision, notes } = payload;
        if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
        await db.run(
          `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
           admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
          decision, notes ?? null, id,
        );
        const row = await db.get('SELECT id, status, admin_notes, title FROM ai_proposals WHERE id = ?', id);
        return res.json({ ok: true, row });
      }

      // proposal.create: { action, feedback_id?, title, summary, category, risk, source, proposed_changes? }
      if (action === 'proposal.create') {
        const { feedback_id, title, summary, category, risk, source, proposed_changes } = payload;
        if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
        const r = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          feedback_id ?? null,
          title,
          summary,
          category ?? null,
          risk || 'medium',
          source ?? null,
          proposed_changes ? JSON.stringify(proposed_changes) : null,
        );
        const created = await db.get('SELECT id, title, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
        return res.json({ ok: true, created });
      }

      // proposal.message: { action, id, text }
      if (action === 'proposal.message') {
        const { id, text } = payload;
        if (!id || !text) return res.status(400).json({ error: 'id and text required' });
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          id, text,
        );
        return res.json({ ok: true });
      }

      // feedback.patch: { action, id, status?, admin_reply? }
      if (action === 'feedback.patch') {
        const { id, status, admin_reply } = payload;
        if (!id) return res.status(400).json({ error: 'id required' });
        const cur = await db.get('SELECT id, status, user_id FROM feedback WHERE id = ?', id);
        if (!cur) return res.status(404).json({ error: 'feedback not found' });
        const newStatus = status ?? cur.status;
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = CASE WHEN ? IN ('awaiting_approval','closed') AND status NOT IN ('awaiting_approval','closed')
                                THEN NULL ELSE resolved_by END,
             resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') AND status NOT IN ('awaiting_approval','closed')
                                THEN NOW() ELSE resolved_at END,
             updated_at = NOW()
           WHERE id = ?`,
          newStatus, admin_reply ?? null, newStatus, newStatus, id,
        );
        const row = await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id);
        return res.json({ ok: true, row });
      }

      // feedback.message: { action, id, text }
      if (action === 'feedback.message') {
        const { id, text } = payload;
        if (!id || !text) return res.status(400).json({ error: 'id and text required' });
        const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', id);
        if (!fb) return res.status(404).json({ error: 'feedback not found' });
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          id, text,
        );
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    res.json({ ops: ['proposals', 'proposal_messages', 'feedback', 'exec'] });
  }),
);

export default router;
