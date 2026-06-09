// TEMP: daily-run AI endpoint (2026-06-09-v58). Remove after use.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'drun-v58-9e2c4a7f1b3d';

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const op = req.query.op;

    // ---------- READ ----------

    if (op === 'proposals') {
      const status = req.query.status || 'pending';
      const rows = await db.all(
        `SELECT p.*,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id, f.status AS feedback_status
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC LIMIT 100`,
        status,
      );
      return res.json({ data: rows });
    }

    if (op === 'proposal-thread') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
                f.context, f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval')
         ORDER BY f.created_at ASC
         LIMIT 200`,
      );
      const ids = rows.map((r) => r.id);
      let messages = [];
      if (ids.length > 0) {
        messages = await db.all(
          `SELECT id, feedback_id, user_id, user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY(ARRAY[${ids.join(',')}]::int[])
           ORDER BY created_at ASC`,
        );
      }
      const threads = {};
      for (const m of messages) {
        if (!threads[m.feedback_id]) threads[m.feedback_id] = [];
        threads[m.feedback_id].push(m);
      }
      return res.json({ data: rows.map((r) => ({ ...r, thread: threads[r.id] || [] })) });
    }

    // ---------- WRITE ----------

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, id, status: decision });
    }

    if (op === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const txt = req.query.txt
        ? Buffer.from(req.query.txt, 'base64').toString('utf8')
        : null;
      if (!txt) return res.status(400).json({ error: 'txt required (base64)' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        id, txt,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const txt = req.query.txt
        ? Buffer.from(req.query.txt, 'base64').toString('utf8')
        : null;
      if (!txt) return res.status(400).json({ error: 'txt required (base64)' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?)`,
        feedback_id, txt,
      );
      return res.json({ ok: true });
    }

    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply
        ? Buffer.from(req.query.reply, 'base64').toString('utf8')
        : null;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, reply, id,
      );
      return res.json({ ok: true, id, status });
    }

    if (op === 'create-proposal') {
      const data = JSON.parse(Buffer.from(req.query.data, 'base64').toString('utf8'));
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

    return res.status(400).json({ error: 'unknown op' });
  }),
);

export default router;
