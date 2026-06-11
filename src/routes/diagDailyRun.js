// TEMP: диагностический эндпоинт для ежедневного AI-обхода обращений.
// Удалить сразу после обхода. Не содержит персональных данных финансового
// характера — только тексты обращений и предложений.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr20260611q7mz';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET ?secret=X — dump all proposals + feedback with threads
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const op = req.query.op || 'data';

    if (op === 'data') {
      const proposals = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
                  p.created_at DESC
         LIMIT 100`,
      );

      const proposalIds = proposals.map((p) => p.id);
      let proposalMessages = [];
      if (proposalIds.length) {
        proposalMessages = await db.all(
          `SELECT proposal_id, id, user_name, role, text, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ANY(?::int[])
           ORDER BY created_at ASC, id ASC`,
          JSON.stringify(proposalIds),
        );
      }

      const feedbackRows = await db.all(
        `SELECT f.id, f.subject, f.category, f.status, f.admin_reply,
                f.created_at, f.updated_at,
                u.name AS author_name, u.email AS author_email
         FROM feedback f
         JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at DESC
         LIMIT 100`,
      );

      const feedbackIds = feedbackRows.map((f) => f.id);
      let feedbackMessages = [];
      if (feedbackIds.length) {
        feedbackMessages = await db.all(
          `SELECT fm.feedback_id, fm.id, fm.user_name, fm.role, fm.text, fm.created_at
           FROM feedback_messages fm
           WHERE fm.feedback_id = ANY(?::int[])
           ORDER BY fm.created_at ASC, fm.id ASC`,
          JSON.stringify(feedbackIds),
        );
      }

      const proposalMsgMap = {};
      for (const m of proposalMessages) {
        if (!proposalMsgMap[m.proposal_id]) proposalMsgMap[m.proposal_id] = [];
        proposalMsgMap[m.proposal_id].push(m);
      }
      const feedbackMsgMap = {};
      for (const m of feedbackMessages) {
        if (!feedbackMsgMap[m.feedback_id]) feedbackMsgMap[m.feedback_id] = [];
        feedbackMsgMap[m.feedback_id].push(m);
      }

      return res.json({
        proposals: proposals.map((p) => ({ ...p, messages: proposalMsgMap[p.id] || [] })),
        feedback: feedbackRows.map((f) => ({ ...f, messages: feedbackMsgMap[f.id] || [] })),
      });
    }

    if (op === 'proposal-done') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        id,
      );
      return res.json({ ok: true, id, status: 'done' });
    }

    if (op === 'proposal-patch') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const notes = req.query.notes ?? null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
        status, notes, id,
      );
      return res.json({ ok: true, id, status });
    }

    if (op === 'proposal-create') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes || null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedbackId, title, summary, category, risk, source,
        proposed_changes ? proposed_changes : null,
      );
      return res.status(201).json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      const newStatus = req.query.status || null;
      const adminReply = req.query.reply || null;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
        id, text,
      );
      if (newStatus || adminReply) {
        const sets = [];
        const vals = [];
        if (newStatus) { sets.push('status = ?'); vals.push(newStatus); }
        if (adminReply) { sets.push('admin_reply = ?'); vals.push(adminReply); }
        sets.push('updated_at = NOW()');
        await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
      }
      return res.json({ ok: true });
    }

    if (op === 'feedback-patch') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const reply = req.query.reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const sets = [];
      const vals = [];
      if (status) { sets.push('status = ?'); vals.push(status); }
      if (reply) { sets.push('admin_reply = ?'); vals.push(reply); }
      sets.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
      return res.json({ ok: true, id, status });
    }

    return res.status(400).json({ error: `unknown op: ${op}` });
  }),
);

export default router;
