import express from 'express';
import { db } from '../db.js';

const router = express.Router();
const SECRET = 'daily-v397-2f9c61ab7e04d3';

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

    if (op === 'proposal-messages') {
      const id = req.query.id;
      const rows = await db.all(
        `SELECT id, user_name, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        id
      );
      return res.json({ rows });
    }

    // --- write ops (secret-gated, used only within this session's obход) ---

    if (op === 'post-feedback-message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        feedbackId,
        text,
      );
      return res.json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    if (op === 'set-feedback-status') {
      const feedbackId = Number(req.query.feedback_id);
      const status = req.query.status;
      if (!feedbackId || !status) return res.status(400).json({ error: 'feedback_id and status required' });
      await db.run(`UPDATE feedback SET status = ?, updated_at = NOW() WHERE id = ?`, status, feedbackId);
      return res.json({ ok: true });
    }

    if (op === 'post-proposal') {
      const { feedback_id, title, summary, category, risk, source } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || 'daily-run',
      );
      return res.json({ id: r.lastInsertRowid });
    }

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = req.query.notes || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
        decision,
        notes,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal-message') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        id,
        text,
      );
      return res.json({ id: r.lastInsertRowid, created_at: r.created_at });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
