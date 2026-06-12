// TEMP: Ежедневный AI-обход — чтение и операции с одноразовым секретом.
// УДАЛИТЬ после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'k7n3m2p9q4x8r1w5';

router.use((req, res, next) => {
  if (req.query?.s === SECRET) {
    req.diagUser = { id: 0, role: 'admin', name: 'AI ассистент' };
    return next();
  }
  return res.status(403).json({ error: 'forbidden' });
});

// GET /api/diag/daily-read?s=SECRET
// Возвращает proposals (по статусам) + feedback open/awaiting_approval с тредами.
router.get(
  '/daily-read',
  asyncHandler(async (req, res) => {
    const [approved, revision, rejected, pending] = await Promise.all([
      db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC`),
      db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC`),
    ]);

    const feedbackRows = await db.all(
      `SELECT f.id, f.category, f.subject, f.message, f.status, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    const feedbackWithThreads = await Promise.all(
      feedbackRows.map(async (fb) => {
        const messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        return { ...fb, messages };
      }),
    );

    const proposalsWithMsgs = await Promise.all(
      [...approved, ...revision, ...pending].map(async (p) => {
        const messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
        return { ...p, messages };
      }),
    );

    const byStatus = (list, status) => proposalsWithMsgs.filter((p) => p.status === status);

    res.json({
      proposals: {
        approved: byStatus(proposalsWithMsgs, 'approved'),
        revision: byStatus(proposalsWithMsgs, 'revision'),
        rejected,
        pending: byStatus(proposalsWithMsgs, 'pending'),
      },
      feedback: feedbackWithThreads,
    });
  }),
);

// GET /api/diag/daily-op?s=SECRET&op=OPERATION&...
// Выполняет одну операцию за вызов.
router.get(
  '/daily-op',
  asyncHandler(async (req, res) => {
    const op = req.query.op;
    const u = req.diagUser;

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = req.query.notes ? decodeURIComponent(req.query.notes) : null;
      if (!id || !decision) return res.status(400).json({ error: 'id, decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        decision, notes, id,
      );
      return res.json({ ok: true, id, decision });
    }

    if (op === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id, text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?)`,
        id, u.id, u.name, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text ? decodeURIComponent(req.query.text) : null;
      if (!id || !text) return res.status(400).json({ error: 'id, text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?)`,
        id, u.id, u.name, text,
      );
      return res.json({ ok: true });
    }

    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply ? decodeURIComponent(req.query.reply) : null;
      if (!id || !status) return res.status(400).json({ error: 'id, status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        status, reply, id,
      );
      return res.json({ ok: true, id, status });
    }

    if (op === 'create-proposal') {
      const title = req.query.title ? decodeURIComponent(req.query.title) : null;
      const summary = req.query.summary ? decodeURIComponent(req.query.summary) : null;
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source ? decodeURIComponent(req.query.source) : `daily-run-${new Date().toISOString().slice(0, 10)}`;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changes = req.query.changes ? decodeURIComponent(req.query.changes) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title, summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        changes || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op', ops: ['patch-proposal','post-proposal-msg','post-feedback-msg','patch-feedback','create-proposal'] });
  }),
);

export default router;
