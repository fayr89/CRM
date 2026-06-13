// ВРЕМЕННЫЙ диаг-эндпоинт для AI daily-run 2026-06-13-s41.
// Удалить после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr-s41-k9m2x4p7';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-run/proposals?status=...
router.get('/proposals', async (req, res) => {
  try {
    const where = req.query.status ? `WHERE p.status = '${req.query.status.replace(/'/g, '')}'` : '';
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/proposals/:id/messages
router.get('/proposals/:id/messages', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      Number(req.params.id),
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/proposals — создать
router.post('/proposals', async (req, res) => {
  try {
    const d = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      d.feedback_id ?? null,
      d.title,
      d.summary,
      d.category ?? null,
      d.risk || 'medium',
      d.source ?? null,
      d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-run/proposals/:id
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { decision, notes, summary, title, proposed_changes } = req.body;
    const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    if (decision) {
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
        decision, notes ?? cur.admin_notes, cur.id,
      );
    }
    if (summary !== undefined || title !== undefined || proposed_changes !== undefined) {
      await db.run(
        `UPDATE ai_proposals SET
           summary = COALESCE(?, summary),
           title = COALESCE(?, title),
           proposed_changes = COALESCE(?::jsonb, proposed_changes),
           updated_at = NOW()
         WHERE id = ?`,
        summary ?? null, title ?? null,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
        cur.id,
      );
    }
    res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/proposals/:id/messages
router.post('/proposals/:id/messages', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { text, user_name } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
      id, user_name || 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/feedback — все feedback с thread
router.get('/feedback', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const ids = rows.map((r) => r.id);
    let msgs = [];
    if (ids.length) {
      msgs = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY(?::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        `{${ids.join(',')}}`,
      );
    }
    const msgsByFeedback = {};
    for (const m of msgs) {
      if (!msgsByFeedback[m.feedback_id]) msgsByFeedback[m.feedback_id] = [];
      msgsByFeedback[m.feedback_id].push(m);
    }
    res.json({ data: rows.map((r) => ({ ...r, thread: msgsByFeedback[r.id] || [] })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-run/feedback/:id
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    await db.run(
      `UPDATE feedback SET
         status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status ?? null, admin_reply ?? null, cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/feedback/:id/messages
router.post('/feedback/:id/messages', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { text, user_name } = req.body;
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
      id, user_name || 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
