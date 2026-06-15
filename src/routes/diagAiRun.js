// TEMP: временный эндпоинт для ежедневного AI-обхода.
// Удалить после завершения обхода отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'airun2026k8m3p';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/ai-run — дамп всех предложений (по статусу) + feedback с тредами
router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status || null;
  const proposalWhere = status ? `WHERE p.status = '${status.replace(/'/g, "''")}'` : '';

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ${proposalWhere}
     ORDER BY p.created_at DESC
     LIMIT 200`,
  );

  // Тред для каждого предложения
  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.updated_at DESC
     LIMIT 100`,
  );

  for (const f of feedback) {
    f.thread = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      f.id,
    );
  }

  res.json({ proposals, feedback });
}));

// GET /api/diag/ai-run/proposal-messages/:id — тред предложения
router.get('/proposal-messages/:id', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT id, user_id, user_name, role, text, created_at
     FROM ai_proposal_messages WHERE proposal_id = ?
     ORDER BY created_at ASC, id ASC`,
    req.params.id,
  );
  res.json({ data: rows });
}));

// POST /api/diag/ai-run/proposal — создать ai_proposal
router.post('/proposal', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposals
     (feedback_id, title, summary, category, risk, source, proposed_changes)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
    b.feedback_id ?? null,
    String(b.title || '').slice(0, 200),
    String(b.summary || '').slice(0, 5000),
    b.category ?? null,
    b.risk || 'medium',
    b.source ?? null,
    b.proposed_changes ? JSON.stringify(b.proposed_changes) : null,
  );
  const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
  res.status(201).json(created);
}));

// PATCH /api/diag/ai-run/proposal/:id — изменить статус предложения
router.patch('/proposal/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  await db.run(
    `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
    b.decision,
    b.notes ?? null,
    req.params.id,
  );
  res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id));
}));

// POST /api/diag/ai-run/proposal/:id/message — сообщение в тред предложения
router.post('/proposal/:id/message', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
     VALUES (?, 0, ?, 'admin', ?) RETURNING id, created_at`,
    req.params.id,
    b.user_name || 'AI ассистент',
    String(b.text || '').slice(0, 5000),
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /api/diag/ai-run/feedback/:id — обновить статус/ответ обращения
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const vals = [];
  if (b.status) { fields.push('status = ?'); vals.push(b.status); }
  if (b.admin_reply !== undefined) { fields.push('admin_reply = ?'); vals.push(b.admin_reply); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  fields.push('updated_at = NOW()');
  vals.push(req.params.id);
  await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals);
  res.json(await db.get('SELECT id, status, admin_reply, subject FROM feedback WHERE id = ?', req.params.id));
}));

// POST /api/diag/ai-run/feedback/:id/message — сообщение в тред обращения
router.post('/feedback/:id/message', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
     VALUES (?, 0, ?, 'admin', ?, NOW()) RETURNING id, created_at`,
    req.params.id,
    b.user_name || 'AI ассистент',
    String(b.text || '').slice(0, 5000),
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

export default router;
