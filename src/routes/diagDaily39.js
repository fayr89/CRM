// TEMP: ежедневный diag-эндпоинт для AI-обхода. Снести после использования.
// Версия: daily-run 2026-06-16-v39
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr39x7k2mf91';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily39/proposals — все предложения + треды
router.get('/proposals', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY p.created_at DESC
     LIMIT 100`,
  );
  const result = [];
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    result.push({ ...p, messages: msgs });
  }
  res.json({ data: result, total: result.length });
}));

// GET /api/diag/daily39/feedback — open+awaiting_approval с тредами (без base64)
router.get('/feedback', asyncHandler(async (_req, res) => {
  const rows = await db.all(
    `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
            f.admin_reply, f.context, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 100`,
  );
  const result = [];
  for (const f of rows) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      f.id,
    );
    result.push({ ...f, thread: msgs });
  }
  res.json({ data: result });
}));

// POST /api/diag/daily39/write — выполнить мутацию из AI-обхода
// Поддерживает: postProposal, patchProposal, postProposalMsg, postFeedbackMsg, patchFeedback
router.post('/write', asyncHandler(async (req, res) => {
  const { op, payload } = req.body || {};
  if (!op) return res.status(400).json({ error: 'op required' });

  if (op === 'postProposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = payload;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null,
      risk || 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (op === 'patchProposal') {
    const { id, decision, notes } = payload;
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?, updated_at = NOW() WHERE id = ?`,
      decision, notes ?? null, id,
    );
    return res.json({ ok: true });
  }

  if (op === 'postProposalMsg') {
    const { proposal_id, text } = payload;
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      proposal_id, text,
    );
    return res.json({ ok: true });
  }

  if (op === 'postFeedbackMsg') {
    const { feedback_id, text } = payload;
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?)`,
      feedback_id, text,
    );
    return res.json({ ok: true });
  }

  if (op === 'patchFeedback') {
    const { id, status, admin_reply } = payload;
    const fields = [];
    const vals = [];
    if (status !== undefined) { fields.push('status = ?'); vals.push(status); }
    if (admin_reply !== undefined) { fields.push('admin_reply = ?'); vals.push(admin_reply); }
    if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
    fields.push('updated_at = NOW()');
    await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: `unknown op: ${op}` });
}));

export default router;
