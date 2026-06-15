// ВРЕМЕННЫЙ диагностический роут для ежедневного обхода AI-ассистента.
// Аутентификация — по одноразовому секрету в query ?secret=...
// После обхода сносится отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'x7b4r2q9z5m8k1p';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) {
    return res.status(401).json({ error: 'invalid secret' });
  }
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// GET /api/diag/daily-run — полный снимок для ежедневного обхода
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at ASC`,
    );

    const fbIds = feedbacks.map((f) => f.id);
    let threads = [];
    if (fbIds.length) {
      threads = await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${fbIds.join(',')}}`,
      );
    }
    const threadsByFb = {};
    for (const m of threads) {
      if (!threadsByFb[m.feedback_id]) threadsByFb[m.feedback_id] = [];
      threadsByFb[m.feedback_id].push(m);
    }
    const feedbacksFull = feedbacks.map((f) => ({
      ...f,
      messages: threadsByFb[f.id] || [],
    }));

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status != 'done'
       ORDER BY p.created_at ASC`,
    );

    const propIds = proposals.map((p) => p.id);
    let propMessages = [];
    if (propIds.length) {
      propMessages = await db.all(
        `SELECT id, proposal_id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${propIds.join(',')}}`,
      );
    }
    const threadsByProp = {};
    for (const m of propMessages) {
      if (!threadsByProp[m.proposal_id]) threadsByProp[m.proposal_id] = [];
      threadsByProp[m.proposal_id].push(m);
    }
    const proposalsFull = proposals.map((p) => ({
      ...p,
      messages: threadsByProp[p.id] || [],
    }));

    res.json({
      feedbacks: feedbacksFull,
      proposals: proposalsFull,
      ts: new Date().toISOString(),
    });
  }),
);

// GET /api/diag/daily-run/act?secret=...&op=...&...params
router.get(
  '/act',
  asyncHandler(async (req, res) => {
    const { op } = req.query;

    if (op === 'create_proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      let pc = null;
      try { pc = proposed_changes ? JSON.parse(proposed_changes) : null; } catch { /* ignore */ }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title,
        summary,
        category || null,
        risk || 'medium',
        source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
        pc ? JSON.stringify(pc) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'mark_proposal_done') {
      const { id, feedback_id, admin_reply } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        Number(id),
      );
      if (feedback_id) {
        await db.run(
          `UPDATE feedback SET status = 'awaiting_approval', admin_reply = ?,
           updated_at = NOW() WHERE id = ?`,
          admin_reply || null,
          Number(feedback_id),
        );
      }
      return res.json({ ok: true });
    }

    if (op === 'mark_proposal_rejected_done') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        Number(id),
      );
      return res.json({ ok: true });
    }

    if (op === 'post_proposal_msg') {
      const { id, text } = req.query;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
        Number(id),
        text,
      );
      return res.json({ ok: true });
    }

    if (op === 'post_feedback_msg') {
      const { feedback_id, text, status, admin_reply } = req.query;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
        Number(feedback_id),
        text,
      );
      if (status || admin_reply) {
        const sets = [];
        const params = [];
        if (status) { sets.push('status = ?'); params.push(status); }
        if (admin_reply) { sets.push('admin_reply = ?'); params.push(admin_reply); }
        sets.push('updated_at = NOW()');
        await db.run(
          `UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`,
          ...params, Number(feedback_id),
        );
      }
      return res.json({ ok: true });
    }

    if (op === 'close_feedback') {
      const { feedback_id, text } = req.query;
      if (!feedback_id) return res.status(400).json({ error: 'feedback_id required' });
      if (text) {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
          Number(feedback_id), text,
        );
      }
      await db.run(
        `UPDATE feedback SET status = 'closed', updated_at = NOW() WHERE id = ?`,
        Number(feedback_id),
      );
      return res.json({ ok: true });
    }

    if (op === 'update_proposal') {
      const { id, title, summary, risk, category } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const sets = ['updated_at = NOW()', "status = 'pending'"];
      const params = [];
      if (title) { sets.push('title = ?'); params.push(title); }
      if (summary) { sets.push('summary = ?'); params.push(summary); }
      if (risk) { sets.push('risk = ?'); params.push(risk); }
      if (category) { sets.push('category = ?'); params.push(category); }
      await db.run(
        `UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`,
        ...params, Number(id),
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: `unknown op: ${op}` });
  }),
);

export default router;
