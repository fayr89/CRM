// ВРЕМЕННЫЙ диагностический эндпоинт для AI daily-run 2026-06-19.
// Удалить сразу после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'j4p8nm5qkz2x';
const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== DIAG_SECRET && req.body?.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

// Читает всё нужное за один запрос:
// ai_proposals по статусам + feedback (open/awaiting_approval) с тредами
router.get('/', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending] = await Promise.all([
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'approved' ORDER BY p.id`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'revision' ORDER BY p.id`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'rejected' ORDER BY p.id`),
    db.all(`SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id
            FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
            WHERE p.status = 'pending' ORDER BY p.id`),
  ]);

  const [proposalMessages, feedbackRows, feedbackMessages] = await Promise.all([
    db.all(`SELECT * FROM ai_proposal_messages ORDER BY proposal_id, created_at ASC, id ASC`),
    db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    ),
    db.all(`SELECT fm.* FROM feedback_messages fm
            JOIN feedback f ON f.id = fm.feedback_id
            WHERE f.status IN ('open','awaiting_approval')
            ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`),
  ]);

  res.json({
    proposals: { approved, revision, rejected, pending },
    proposal_messages: proposalMessages,
    feedback: feedbackRows,
    feedback_messages: feedbackMessages,
  });
}));

// Создать ai_proposal
router.post('/ai-proposals', asyncHandler(async (req, res) => {
  const d = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    d.feedback_id ?? null,
    d.title,
    d.summary,
    d.category ?? null,
    d.risk ?? 'medium',
    d.source ?? null,
    d.proposed_changes ? JSON.stringify(d.proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// Обновить статус ai_proposal (done / revision / pending)
router.patch('/ai-proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body || {};
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?`,
    decision,
    notes ?? null,
    req.params.id,
  );
  res.json({ ok: true });
}));

// Добавить сообщение в тред ai_proposal
router.post('/ai-proposals/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    req.params.id,
    user_name ?? 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// Обновить feedback (status + admin_reply)
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body || {};
  const cur = await db.get('SELECT * FROM feedback WHERE id = ?', req.params.id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const newStatus = status ?? cur.status;
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
     resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW()
     WHERE id = ?`,
    newStatus,
    admin_reply ?? null,
    cur.id,
  );
  res.json({ ok: true, id: cur.id, status: newStatus });
}));

// Добавить сообщение в тред feedback от имени AI
router.post('/feedback/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id`,
    req.params.id,
    user_name ?? 'AI ассистент',
    text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
