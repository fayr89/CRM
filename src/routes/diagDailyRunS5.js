// TEMP: диагностический эндпоинт для ежедневного AI-обхода 2026-06-11 (сессия 5).
// Удалить сразу после обхода. Не содержит персональных данных финансового характера.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr20260611s5x2p';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET ?secret=X — dump all proposals (with threads) + open/awaiting feedback (with threads)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const statuses = ['approved', 'revision', 'rejected', 'pending'];
    const proposals = {};
    for (const st of statuses) {
      const rows = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC`,
        st,
      );
      for (const p of rows) {
        p.messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM ai_proposal_messages
           WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      proposals[st] = rows;
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
    for (const f of feedbackRows) {
      f.messages = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        f.id,
      );
    }

    res.json({ proposals, feedback: feedbackRows });
  }),
);

// Mark proposal done: GET /proposal-done?secret=X&id=N
router.get(
  '/proposal-done',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
      id,
    );
    res.json({ ok: true, id, status: 'done' });
  }),
);

// Patch proposal status/notes: GET /proposal-patch?secret=X&id=N&status=S&notes=...
router.get(
  '/proposal-patch',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.id);
    const status = req.query.status || null;
    const notes = req.query.notes ?? null;
    if (!id) return res.status(400).json({ error: 'id required' });
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (status) { sets.unshift('status = ?'); vals.push(status); }
    if (notes !== null) { sets.unshift('admin_notes = ?'); vals.push(notes); }
    await db.run(`UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    res.json({ ok: true, id, status });
  }),
);

// Create proposal: GET /proposal-create?secret=X&title=...&summary=...&category=...&risk=...&source=...&feedback_id=N&proposed_changes=JSON
router.get(
  '/proposal-create',
  asyncHandler(async (req, res) => {
    const { title, summary, category, risk, source } = req.query;
    const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const proposedChanges = req.query.proposed_changes || null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      feedbackId, title, summary, category || null, risk || 'medium', source || null, proposedChanges,
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }),
);

// Post message to proposal thread: GET /proposal-msg?secret=X&id=N&text=...
router.get(
  '/proposal-msg',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.id);
    const text = req.query.text || '';
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
      id, text,
    );
    res.json({ ok: true });
  }),
);

// Post message to feedback thread: GET /feedback-msg?secret=X&id=N&text=...&status=OPTIONAL&reply=OPTIONAL
router.get(
  '/feedback-msg',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.id);
    const text = req.query.text || '';
    const newStatus = req.query.status || null;
    const adminReply = req.query.reply || null;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
      id, text,
    );
    if (newStatus || adminReply) {
      const sets = ['updated_at = NOW()'];
      const vals = [];
      if (newStatus) { sets.unshift('status = ?'); vals.push(newStatus); }
      if (adminReply) { sets.unshift('admin_reply = ?'); vals.push(adminReply); }
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    }
    res.json({ ok: true });
  }),
);

// Patch feedback status/reply: GET /feedback-patch?secret=X&id=N&status=S&reply=OPTIONAL
router.get(
  '/feedback-patch',
  asyncHandler(async (req, res) => {
    const id = Number(req.query.id);
    const status = req.query.status || null;
    const reply = req.query.reply || null;
    if (!id) return res.status(400).json({ error: 'id required' });
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (status) { sets.unshift('status = ?'); vals.push(status); }
    if (reply) { sets.unshift('admin_reply = ?'); vals.push(reply); }
    await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    res.json({ ok: true, id, status });
  }),
);

export default router;
