// TEMP: daily-run diag endpoint — удалить сразу после использования
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-2026-06-06-v48';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET ?secret=XXX&action=read — читаем все proposals и feedback
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const action = req.query.action || 'read';

    if (action === 'read') {
      const proposals = await db.all(
        `SELECT p.id, p.title, p.summary, p.category, p.risk, p.source,
                p.status, p.feedback_id, p.admin_notes, p.proposed_changes,
                p.created_at, p.updated_at, p.admin_decision_at
         FROM ai_proposals p
         ORDER BY p.created_at DESC
         LIMIT 100`,
      );
      const proposalIds = proposals.map(p => p.id);
      let proposalMessages = [];
      if (proposalIds.length > 0) {
        proposalMessages = await db.all(
          `SELECT proposal_id, id, user_name, role, text, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ANY($1::int[])
           ORDER BY created_at ASC, id ASC`,
          proposalIds,
        );
      }
      const feedback = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.status,
                f.admin_reply, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC
         LIMIT 50`,
      );
      const feedbackIds = feedback.map(f => f.id);
      let feedbackMessages = [];
      if (feedbackIds.length > 0) {
        feedbackMessages = await db.all(
          `SELECT feedback_id, id, user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY($1::int[])
           ORDER BY created_at ASC, id ASC`,
          feedbackIds,
        );
      }
      return res.json({ proposals, proposalMessages, feedback, feedbackMessages });
    }

    // action=post-proposal — создать ai_proposal
    // params: title, summary, category, risk, source, feedback_id, proposed_changes (base64 json)
    if (action === 'post-proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      let pc = null;
      if (proposed_changes) {
        try { pc = JSON.parse(Buffer.from(proposed_changes, 'base64').toString('utf8')); } catch { /* ok */ }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || null,
        pc ? JSON.stringify(pc) : null,
      );
      const created = await db.get('SELECT id, title, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
      return res.json({ ok: true, created });
    }

    // action=patch-proposal — обновить статус ai_proposal
    // params: id, decision (done/approved/rejected/revision), notes
    if (action === 'patch-proposal') {
      const { id, decision, notes } = req.query;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        notes || null,
        Number(id),
      );
      return res.json({ ok: true, id: Number(id), decision });
    }

    // action=post-proposal-msg — добавить сообщение в тред ai_proposal
    // params: id, text (base64)
    if (action === 'post-proposal-msg') {
      const { id, text } = req.query;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(id),
        decoded,
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    // action=patch-feedback — обновить статус обращения
    // params: id, status, admin_reply (base64)
    if (action === 'patch-feedback') {
      const { id, status, admin_reply } = req.query;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      let reply = null;
      if (admin_reply) {
        try { reply = Buffer.from(admin_reply, 'base64').toString('utf8'); } catch { /* ok */ }
      }
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
         WHERE id = ?`,
        status,
        reply,
        Number(id),
      );
      return res.json({ ok: true, id: Number(id), status });
    }

    // action=post-feedback-msg — добавить сообщение в тред feedback
    // params: id, text (base64)
    if (action === 'post-feedback-msg') {
      const { id, text } = req.query;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(id),
        decoded,
      );
      return res.json({ ok: true, message_id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
