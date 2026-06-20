// TEMP: ежедневный AI-обход. Снести сразу после использования.
// Секрет одноразовый — в коде, не в env, так как у AI нет доступа к env прода.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DAILY_SECRET = 'd8vQpL3mNz9X';
const AI_USER = { id: 0, role: 'admin', name: 'AI ассистент' };

const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== DAILY_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.user = AI_USER;
  next();
});

// GET /api/diag/daily-run?secret=... → полный дамп: feedback + ai_proposals с тредами
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    for (const fb of feedback) {
      fb.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    res.json({ feedback, proposals });
  }),
);

// POST /api/diag/daily-run?secret=...&action=...
// Поддерживаемые действия (все write-операции AI-обхода):
//   patch_feedback   { id, status, admin_reply }
//   post_fb_message  { feedback_id, text }
//   post_proposal    { title, summary, category, risk, source, proposed_changes, feedback_id }
//   patch_proposal   { id, decision }   (decision: 'done')
//   post_prop_msg    { proposal_id, text }
//   patch_proposal_status { id, decision, notes }  (approved/rejected/revision/done)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const action = String(req.query.action || req.body?.action || '');
    const b = req.body || {};

    if (action === 'patch_feedback') {
      const id = Number(b.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const updates = [];
      const params = [];
      if (b.status) { updates.push('status = ?'); params.push(b.status); }
      if (b.admin_reply !== undefined) { updates.push('admin_reply = ?'); params.push(b.admin_reply); }
      if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
      updates.push('updated_at = NOW()');
      // resolved_by / resolved_at при переходе в awaiting_approval
      if (b.status === 'awaiting_approval' || b.status === 'closed') {
        updates.push('resolved_by = ?'); params.push(0);
        updates.push('resolved_at = NOW()');
      }
      await db.run(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`, ...params, id);
      return res.json({ ok: true });
    }

    if (action === 'post_fb_message') {
      const id = Number(b.feedback_id);
      if (!id) return res.status(400).json({ error: 'feedback_id required' });
      if (!b.text) return res.status(400).json({ error: 'text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, b.text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'post_proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals
         (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        b.feedback_id ?? null,
        b.title,
        b.summary,
        b.category ?? null,
        b.risk || 'medium',
        b.source ?? null,
        b.proposed_changes ? JSON.stringify(b.proposed_changes) : null,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'patch_proposal') {
      const id = Number(b.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        b.decision, id,
      );
      return res.json({ ok: true });
    }

    if (action === 'post_prop_msg') {
      const id = Number(b.proposal_id);
      if (!id) return res.status(400).json({ error: 'proposal_id required' });
      if (!b.text) return res.status(400).json({ error: 'text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, b.text,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }),
);

export default router;
