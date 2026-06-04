// TEMPORARY DIAG — daily AI run v12 — DELETE AFTER USE
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr12-rM8vK4nX7jB';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;

    if (op === 'proposals') {
      const st = req.query.status;
      const rows = st
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status, f.user_id AS feedback_user_id, f.admin_notes AS feedback_admin_notes FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`,
            st,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id ORDER BY p.created_at DESC LIMIT 100`,
          );
      return res.json({ data: rows });
    }

    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC LIMIT 200`,
      );
      const result = [];
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;
    const b = req.body || {};

    if (op === 'patch-proposal') {
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, b.decision, b.id);
      return res.json({ ok: true });
    }

    if (op === 'post-msg') {
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        b.feedback_id, b.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = b;
      const fields = [];
      const vals = [];
      if (status) { fields.push('status = ?'); vals.push(status); }
      if (admin_reply) { fields.push('admin_reply = ?'); vals.push(admin_reply); }
      if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
      fields.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        b.feedback_id ?? null, b.title, b.summary,
        b.category ?? null, b.risk || 'medium', b.source ?? null,
        b.proposed_changes ? JSON.stringify(b.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
