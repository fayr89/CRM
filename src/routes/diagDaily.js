// TEMP: ежедневный diag-эндпоинт для AI-ассистента (сессия NzKnR-2026-06-02)
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'daily-NzKnR-k7p3q8m2';

function checkSecret(req, res) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-NzKnR?s=SECRET
// Возвращает все ai_proposals (по статусам) + feedback (open/awaiting_approval) с thread
router.get('/', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const [approved, revision, rejected, feedback] = await Promise.all([
    db.all("SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at"),
    db.all("SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at"),
    db.all("SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at"),
    db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
            FROM feedback f
            LEFT JOIN users u ON u.id = f.user_id
            WHERE f.status IN ('open','awaiting_approval')
            ORDER BY f.created_at DESC`),
  ]);

  // Подтягиваем thread для каждого feedback
  const feedbackWithThread = await Promise.all(feedback.map(async (fb) => {
    const thread = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    return { ...fb, thread };
  }));

  res.json({ proposals: { approved, revision, rejected }, feedback: feedbackWithThread });
}));

// POST /api/diag/daily-NzKnR/proposal?s=SECRET — создать ai_proposal
router.post('/proposal', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    feedback_id ?? null,
    title,
    summary,
    category ?? null,
    risk || 'medium',
    source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
  res.status(201).json(created);
}));

// PATCH /api/diag/daily-NzKnR/proposal/:id?s=SECRET — обновить статус ai_proposal
router.patch('/proposal/:id', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { decision, notes } = req.body || {};
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
    decision,
    notes ?? null,
    req.params.id,
  );
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id));
}));

// POST /api/diag/daily-NzKnR/feedback/:id/msg?s=SECRET — добавить сообщение в thread
router.post('/feedback/:id/msg', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { text } = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
    req.params.id,
    text,
  );
  res.status(201).json(await db.get(
    'SELECT id, user_name, role, text, created_at FROM feedback_messages WHERE id = ?',
    r.lastInsertRowid,
  ));
}));

// PATCH /api/diag/daily-NzKnR/feedback/:id?s=SECRET — обновить статус/ответ feedback
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { status, admin_reply } = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });

  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';

  await db.run(
    `UPDATE feedback SET
       status = ?,
       admin_reply = COALESCE(?, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    admin_reply ?? null,
    cur.id,
  );
  res.json(await db.get('SELECT * FROM feedback WHERE id = ?', cur.id));
}));

export default router;
