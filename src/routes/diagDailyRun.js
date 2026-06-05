// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода.
// Удалить сразу после использования — отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const DIAG_SECRET = 'f4a91b3e7c2d5f8a0e6b4c9d1f3a7e2b';

function checkSecret(req, res, next) {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

router.use(checkSecret);

// GET /api/diag/daily-run/proposals?status=X
router.get('/proposals', async (req, res) => {
  try {
    const where = req.query.status ? 'WHERE p.status = $1' : '';
    const params = req.query.status ? [req.query.status] : [];
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${where}
       ORDER BY p.created_at DESC`,
      ...params,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-run/proposals/:id  { decision, notes }
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { decision, notes } = req.body || {};
    await db.run(
      `UPDATE ai_proposals SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3`,
      decision, notes ?? null, req.params.id,
    );
    const row = await db.get('SELECT * FROM ai_proposals WHERE id = $1', req.params.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/proposals  { feedback_id?, title, summary, category, risk, source, proposed_changes? }
router.post('/proposals', async (req, res) => {
  try {
    const d = req.body || {};
    const row = await db.get(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
      d.feedback_id ?? null,
      d.title,
      d.summary,
      d.category ?? null,
      d.risk || 'medium',
      d.source ?? null,
      d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
    );
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-run/feedback  — все open/awaiting с тредами
router.get('/feedback', async (req, res) => {
  try {
    const statuses = req.query.status ? [req.query.status] : ['open', 'awaiting_approval'];
    const placeholders = statuses.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN (${placeholders})
       ORDER BY f.created_at DESC`,
      ...statuses,
    );
    for (const fb of rows) {
      fb.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/daily-run/feedback/:id  { status?, admin_reply? }
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body || {};
    const cur = await db.get('SELECT * FROM feedback WHERE id = $1', req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = $1,
         admin_reply = COALESCE($2, admin_reply),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = $3`,
      newStatus,
      admin_reply ?? null,
      cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = $1', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-run/feedback/:id/messages  { text, user_name }
router.post('/feedback/:id/messages', async (req, res) => {
  try {
    const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = $1', req.params.id);
    if (!fb) return res.status(404).json({ error: 'not found' });
    const { text, user_name } = req.body || {};
    const msg = await db.get(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id, user_id, user_name, role, text, created_at`,
      fb.id,
      null,
      user_name || 'AI ассистент',
      text,
    );
    res.status(201).json(msg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
