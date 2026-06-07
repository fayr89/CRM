// TEMP: daily-run diag endpoint for AI 2026-06-07-v4. Remove after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-07-v4-rQ9pL5';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}
router.use(checkSecret);

// GET /api/diag/ai-proposals?status=approved|revision|rejected|pending
router.get('/ai-proposals', async (req, res) => {
  try {
    const where = req.query.status ? `WHERE p.status = '${req.query.status.replace(/[^a-z_]/g, '')}'` : '';
    const rows = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       ${where}
       ORDER BY p.created_at DESC LIMIT 100`,
    );
    // Fetch messages for each
    for (const row of rows) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        row.id,
      );
      row.messages = msgs;
    }
    res.json({ data: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/feedback-full — all open+awaiting_approval feedback with messages
router.get('/feedback-full', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC LIMIT 200`,
    );
    for (const row of rows) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        row.id,
      );
      row.messages = msgs;
    }
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/feedback-message — post a message as "AI ассистент"
// body: { feedback_id, text }
router.post('/feedback-message', async (req, res) => {
  try {
    const { feedback_id, text } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    if (!admin) return res.status(500).json({ error: 'No admin found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, admin.id, text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/feedback-status — update feedback status
// body: { feedback_id, status, admin_reply? }
router.patch('/feedback-status', async (req, res) => {
  try {
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    const justResolved = status === 'awaiting_approval' || status === 'closed';
    await db.run(
      `UPDATE feedback SET status = ?,
       admin_reply = COALESCE(?, admin_reply),
       resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
       resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
       updated_at = NOW()
       WHERE id = ?`,
      status, admin_reply ?? null, justResolved, admin?.id ?? null,
      justResolved, feedback_id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/ai-proposal — create a new ai_proposal
// body: { title, summary, category, risk, source, feedback_id?, proposed_changes? }
router.post('/ai-proposal', async (req, res) => {
  try {
    const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/ai-proposal-decision — mark proposal as done
// body: { id, decision }
router.patch('/ai-proposal-decision', async (req, res) => {
  try {
    const { id, decision } = req.body;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, admin?.id ?? null, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/ai-proposal-message — post a message to ai_proposal thread
// body: { proposal_id, text }
router.post('/ai-proposal-message', async (req, res) => {
  try {
    const { proposal_id, text } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    if (!admin) return res.status(500).json({ error: 'No admin found' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
      proposal_id, admin.id, text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
