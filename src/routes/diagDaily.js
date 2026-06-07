// TEMP — daily AI run diag endpoint. DELETE AFTER USE.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'd7k2-daily-20260607';

function auth(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET ?secret=&op=proposals&status=X
// GET ?secret=&op=proposal-messages&id=X
// GET ?secret=&op=feedback-full
router.get('/', async (req, res) => {
  if (!auth(req, res)) return;
  const { op } = req.query;
  try {
    if (op === 'proposals') {
      const { status } = req.query;
      const where = status ? 'WHERE p.status = ?' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where} ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json(rows);
    }
    if (op === 'proposal-messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        'SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC',
        id,
      );
      return res.json(rows);
    }
    if (op === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
      );
      for (const fb of feedbacks) {
        fb.thread = await db.all(
          'SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC',
          fb.id,
        );
      }
      return res.json(feedbacks);
    }
    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST ?secret=&op=patch-proposal     body: {id, decision, notes?}
// POST ?secret=&op=create-proposal    body: proposal fields
// POST ?secret=&op=proposal-message   body: {proposal_id, text}
// POST ?secret=&op=feedback-message   body: {feedback_id, text}
// POST ?secret=&op=update-feedback    body: {id, status, admin_reply?}
router.post('/', async (req, res) => {
  if (!auth(req, res)) return;
  const { op } = req.query;
  const body = req.body || {};
  try {
    if (op === 'patch-proposal') {
      const { id, decision, notes } = body;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes ?? null, id,
      );
      return res.json({ ok: true });
    }
    if (op === 'create-proposal') {
      const { title, summary, category, risk, source, proposed_changes, feedback_id } = body;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id ?? null, title, summary, category ?? null,
        risk || 'medium', source ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }
    if (op === 'proposal-message') {
      const { proposal_id, text } = body;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        proposal_id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'feedback-message') {
      const { feedback_id, text } = body;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text) VALUES (?, 'AI ассистент', 'admin', ?)`,
        feedback_id, text,
      );
      return res.json({ ok: true });
    }
    if (op === 'update-feedback') {
      const { id, status, admin_reply } = body;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply ?? null, id,
      );
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
