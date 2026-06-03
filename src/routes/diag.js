// ВРЕМЕННЫЙ диагностический роут — удалить после одного использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '5ec532e908cce5831d1141604729fba3';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET && req.body?.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get(
  '/feedback-full',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const feedback = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const ids = feedback.map(r => r.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        `{${ids.join(',')}}`,
      );
    }
    const proposals = await db.all(
      `SELECT id, status, title, summary, category, risk, source,
              feedback_id, admin_notes, created_at
       FROM ai_proposals
       WHERE status IN ('approved','revision','rejected')
       ORDER BY created_at DESC`,
    );
    res.json({ feedback, messages, proposals });
  }),
);

// POST /api/diag/ai-proposal — создать ai_proposal без авторизации (только с секретом).
router.post(
  '/ai-proposal',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk ?? 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(created);
  }),
);

// POST /api/diag/feedback-message — добавить сообщение в тред от AI ассистента.
router.post(
  '/feedback-message',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { feedback_id, text } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    const created = await db.get('SELECT * FROM feedback_messages WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(created);
  }),
);

// PATCH /api/diag/feedback-status — сменить статус обращения.
router.patch(
  '/feedback-status',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { feedback_id, status, admin_reply } = req.body;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
      status, admin_reply ?? null, feedback_id,
    );
    res.json(await db.get('SELECT * FROM feedback WHERE id = ?', feedback_id));
  }),
);

export default router;
