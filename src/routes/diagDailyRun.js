// ВРЕМЕННЫЙ диагностический роут для ежедневного обхода AI.
// УДАЛИТЬ СРАЗУ ПОСЛЕ ИСПОЛЬЗОВАНИЯ отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'dr-2026-06-26-mK9pL';
const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-run/dump?secret=… — всё нужное для обхода одним запросом
router.get('/dump', asyncHandler(async (_req, res) => {
  const [approved, revision, rejected, pending] = await Promise.all([
    db.all(`SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status = 'approved' ORDER BY p.created_at DESC`),
    db.all(`SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status = 'revision' ORDER BY p.created_at DESC`),
    db.all(`SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status = 'rejected' ORDER BY p.created_at DESC LIMIT 20`),
    db.all(`SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status = 'pending' ORDER BY p.created_at DESC`),
  ]);

  const allProposals = [...approved, ...revision, ...rejected, ...pending];
  for (const p of allProposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  const feedbacks = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open', 'awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }

  res.json({ proposals: { approved, revision, rejected, pending }, feedbacks });
}));

// POST /api/diag/daily-run/action?secret=… body: {action, ...params}
router.post('/action', asyncHandler(async (req, res) => {
  const { action, ...p } = req.body || {};

  if (action === 'patch_proposal') {
    // { id, decision }
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      p.decision, p.id,
    );
    return res.json({ ok: true });
  }

  if (action === 'post_proposal_message') {
    // { proposal_id, text }
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      p.proposal_id, p.text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'create_proposal') {
    // { feedback_id?, title, summary, category, risk, source, proposed_changes? }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      p.feedback_id ?? null,
      p.title,
      p.summary,
      p.category ?? null,
      p.risk || 'medium',
      p.source ?? null,
      p.proposed_changes ? JSON.stringify(p.proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'patch_feedback') {
    // { id, status?, admin_reply? }
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', p.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = p.status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    if (justResolved) {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        newStatus, p.admin_reply ?? null, p.id,
      );
    } else {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW() WHERE id = ?`,
        newStatus, p.admin_reply ?? null, p.id,
      );
    }
    return res.json({ ok: true });
  }

  if (action === 'post_feedback_message') {
    // { feedback_id, text }
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      p.feedback_id, p.text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown action', known: ['patch_proposal','post_proposal_message','create_proposal','patch_feedback','post_feedback_message'] });
}));

export default router;
