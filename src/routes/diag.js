// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода.
// УДАЛИТЬ после использования (отдельным коммитом).
// Секрет передаётся в ?secret= — одноразовый, только для этой сессии.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const DIAG_SECRET = 'dr-2026-06-06-v62-k9w2x';

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=X&op=read-all
router.get('/daily', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const op = req.query.op || 'read-all';

    if (op === 'read-all') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status IN ('approved','revision','rejected','pending')
         ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
                  p.created_at DESC`,
      );
      for (const p of proposals) {
        p.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }

      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at ASC`,
      );
      for (const fb of feedbacks) {
        fb.thread = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }

      return res.json({ proposals, feedbacks });
    }

    if (op === 'patch-proposal') {
      const { id, decision } = req.query;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision,
        Number(id),
      );
      return res.json({ ok: true, id: Number(id), status: decision });
    }

    if (op === 'post-proposal') {
      const { title, summary, category, risk, source } = req.query;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      let changesJson = null;
      if (req.query.proposed_changes) {
        try { changesJson = JSON.stringify(JSON.parse(req.query.proposed_changes)); } catch { changesJson = null; }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
        changesJson,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = req.query;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        status,
        admin_reply || null,
        Number(id),
      );
      return res.json({ ok: true, id: Number(id), status });
    }

    if (op === 'post-feedback-msg') {
      const { feedback_id, text } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
        Number(feedback_id),
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'post-proposal-msg') {
      const { proposal_id, text } = req.query;
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(proposal_id),
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `Unknown op: ${op}` });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
