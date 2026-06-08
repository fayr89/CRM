// TEMP: AI ежедневный обход (2026-06-08). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-2026-06-08-k9m3r7t2';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.s !== SECRET) return res.status(404).json({ error: 'not found' });
    const cmd = req.query.cmd || 'read';

    if (cmd === 'read') {
      const proposals = await db.all(`
        SELECT p.id, p.status, p.title, p.summary, p.category, p.risk, p.source,
               p.feedback_id, p.admin_notes, p.admin_decision_at, p.created_at,
               f.subject AS feedback_subject, f.status AS feedback_status
        FROM ai_proposals p
        LEFT JOIN feedback f ON f.id = p.feedback_id
        ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                 p.created_at DESC
      `);
      const proposalThreads = {};
      for (const p of proposals) {
        proposalThreads[p.id] = await db.all(
          `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages
           WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      const feedback = await db.all(`
        SELECT f.id, f.status, f.subject, f.message, f.category, f.admin_reply,
               f.created_at, f.updated_at,
               u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC
      `);
      const feedbackThreads = {};
      for (const fb of feedback) {
        feedbackThreads[fb.id] = await db.all(
          `SELECT id, user_name, role, text, created_at FROM feedback_messages
           WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ proposals, proposal_threads: proposalThreads, feedback, feedback_threads: feedbackThreads });
    }

    if (cmd === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, id, status: decision });
    }

    if (cmd === 'post-proposal') {
      const title = req.query.title;
      const summary = req.query.summary;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        req.query.feedback_id ? Number(req.query.feedback_id) : null,
        title, summary,
        req.query.category || null,
        req.query.risk || 'medium',
        req.query.source || `daily-run-${new Date().toISOString().slice(0,10)}`,
        req.query.changes ? req.query.changes : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (cmd === 'post-proposal-msg') {
      const proposal_id = Number(req.query.proposal_id);
      const text = req.query.text;
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (cmd === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply || null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
         WHERE id = ?`,
        status, reply, id,
      );
      return res.json({ ok: true, id, status });
    }

    if (cmd === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `Unknown cmd: ${cmd}` });
  }),
);

export default router;
