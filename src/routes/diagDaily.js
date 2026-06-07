// TEMPORARY: diag endpoint for AI daily-run 2026-06-07-v3 (REMOVE AFTER USE)
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'diag-2026-06-07-v3-k9mp4q1x';

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const op = req.query.op || 'read-all';
  try {
    if (op === 'read-all') {
      const proposals = await db.all(`
        SELECT p.*, u.name AS admin_decision_by_name,
               f.subject AS feedback_subject, f.user_id AS feedback_user_id,
               fu.name AS feedback_author_name
        FROM ai_proposals p
        LEFT JOIN users u ON u.id = p.admin_decision_by
        LEFT JOIN feedback f ON f.id = p.feedback_id
        LEFT JOIN users fu ON fu.id = f.user_id
        WHERE p.status != 'done'
        ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                 WHEN 'pending' THEN 2 ELSE 3 END),
                p.created_at DESC
        LIMIT 100
      `);
      const proposalThreads = {};
      for (const p of proposals) {
        proposalThreads[p.id] = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      const feedbacks = await db.all(`
        SELECT f.*, u.name AS user_name_auth, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open', 'awaiting_approval')
        ORDER BY f.created_at DESC
        LIMIT 200
      `);
      const feedbackThreads = {};
      for (const fb of feedbacks) {
        feedbackThreads[fb.id] = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ proposals, proposalThreads, feedbacks, feedbackThreads, ts: new Date().toISOString() });
    }

    // All write ops accept ?data=BASE64_JSON
    const data = req.query.data
      ? JSON.parse(Buffer.from(req.query.data, 'base64').toString('utf8'))
      : {};

    if (op === 'patch-proposal') {
      const { id, decision } = data;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'post-proposal-message') {
      const { proposal_id, text } = data;
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = data;
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT status FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status || cur.status, admin_reply ?? null, id,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-feedback-message') {
      const { feedback_id, text } = data;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown op', ops: ['read-all', 'patch-proposal', 'post-proposal', 'post-proposal-message', 'patch-feedback', 'post-feedback-message'] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
