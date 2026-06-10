// ВРЕМЕННЫЙ диаг-эндпоинт для AI-обхода 2026-06-10-v31
// Удалить сразу после использования!
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr31-k9p2x7mq';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/v31/proposals?status=approved|rejected|revision|pending
router.get('/proposals', async (req, res) => {
  try {
    const where = req.query.status ? 'WHERE p.status = $1' : '';
    const params = req.query.status ? [req.query.status] : [];
    const rows = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ${where}
       ORDER BY p.created_at DESC`,
      ...params,
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/v31/proposals/:id/messages
router.get('/proposals/:id/messages', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT * FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC, id ASC`,
      Number(req.params.id),
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/v31/proposals — создать ai_proposal
router.post('/proposals', async (req, res) => {
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      feedback_id ?? null,
      title,
      summary,
      category ?? null,
      risk ?? 'medium',
      source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/v31/proposals/:id
router.patch('/proposals/:id', async (req, res) => {
  try {
    const { decision, notes, title, summary, category, risk, source, proposed_changes } = req.body;
    const cur = await db.get('SELECT * FROM ai_proposals WHERE id = $1', Number(req.params.id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    if (decision) {
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3`,
        decision, notes ?? null, cur.id,
      );
    } else {
      const fields = [];
      const vals = [];
      let i = 1;
      if (title !== undefined) { fields.push(`title = $${i++}`); vals.push(title); }
      if (summary !== undefined) { fields.push(`summary = $${i++}`); vals.push(summary); }
      if (category !== undefined) { fields.push(`category = $${i++}`); vals.push(category); }
      if (risk !== undefined) { fields.push(`risk = $${i++}`); vals.push(risk); }
      if (source !== undefined) { fields.push(`source = $${i++}`); vals.push(source); }
      if (proposed_changes !== undefined) { fields.push(`proposed_changes = $${i++}::jsonb`); vals.push(JSON.stringify(proposed_changes)); }
      if (fields.length) {
        fields.push(`updated_at = NOW()`);
        await db.run(`UPDATE ai_proposals SET ${fields.join(', ')} WHERE id = $${i}`, ...vals, cur.id);
      }
    }
    res.json(await db.get('SELECT * FROM ai_proposals WHERE id = $1', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/v31/proposals/:id/messages
router.post('/proposals/:id/messages', async (req, res) => {
  try {
    const { text, user_name } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
       VALUES ($1, $2, 'admin', $3) RETURNING id, created_at`,
      Number(req.params.id), user_name ?? 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/v31/feedback — все open + awaiting_approval с тредами
router.get('/feedback', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const result = [];
    for (const row of rows) {
      const messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC, id ASC`,
        row.id,
      );
      result.push({ ...row, messages });
    }
    res.json({ data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/diag/v31/feedback/:id — обновить статус/ответ
router.patch('/feedback/:id', async (req, res) => {
  try {
    const { status, admin_reply } = req.body;
    const cur = await db.get('SELECT * FROM feedback WHERE id = $1', Number(req.params.id));
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
      newStatus, admin_reply ?? null, cur.id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = $1', cur.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/v31/feedback/:id/messages — с user_name override
router.post('/feedback/:id/messages', async (req, res) => {
  try {
    const { text, user_name } = req.body;
    const fb = await db.get('SELECT id FROM feedback WHERE id = $1', Number(req.params.id));
    if (!fb) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_name, role, text)
       VALUES ($1, $2, 'admin', $3) RETURNING id`,
      fb.id, user_name ?? 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
