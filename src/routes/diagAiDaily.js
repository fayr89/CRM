// ВРЕМЕННЫЙ эндпоинт для ежедневного AI-обхода обращений.
// Удалить отдельным коммитом сразу после завершения обхода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'd8f3a2e7c1b4';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  req.user = { id: 0, role: 'admin', name: 'AI ассистент' };
  next();
});

// Читаем всё нужное за один запрос.
router.get('/', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending] = await Promise.all([
    db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC`),
    db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY updated_at DESC`),
  ]);

  const allProposals = [...approved, ...revision, ...rejected, ...pending];
  const proposalMessages = {};
  for (const p of allProposals) {
    proposalMessages[p.id] = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 100`,
  );

  const feedbackMessages = {};
  for (const fb of feedback) {
    feedbackMessages[fb.id] = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({
    proposals: { approved, revision, rejected, pending },
    proposal_messages: proposalMessages,
    feedback,
    feedback_messages: feedbackMessages,
  });
}));

// Выполнить одно действие (пишущая операция).
router.post('/', asyncHandler(async (req, res) => {
  const { action, ...p } = req.body || {};

  if (action === 'create_proposal') {
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      p.feedback_id ?? null, p.title, p.summary, p.category ?? null,
      p.risk || 'medium', p.source ?? null,
      p.proposed_changes ? JSON.stringify(p.proposed_changes) : null,
    );
    return res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (action === 'patch_proposal') {
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      p.decision, p.notes ?? null, p.id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', p.id));
  }

  if (action === 'post_proposal_message') {
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      p.proposal_id, p.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (action === 'patch_feedback') {
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', p.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = p.status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    if (justResolved) {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_by = 0, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        newStatus, p.admin_reply ?? null, p.id,
      );
    } else {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        newStatus, p.admin_reply ?? null, p.id,
      );
    }
    return res.json(await db.get('SELECT * FROM feedback WHERE id = ?', p.id));
  }

  if (action === 'post_feedback_message') {
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      p.feedback_id, p.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  res.status(400).json({ error: 'unknown action', action });
}));

export default router;
