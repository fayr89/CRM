// TEMP: ежедневный обход AI daily-run 2026-06-18 j6ofvs
// Удалить сразу после использования в этом же обходе.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'j6ofvs';

router.use((req, res, next) => {
  if (req.query?.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/daily-j6ofvs?s=j6ofvs
// Возвращает: all ai_proposals + их messages + all feedback (open/awaiting_approval) + их threads
router.get('/', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     ORDER BY p.created_at DESC LIMIT 200`,
  );

  const proposalMsgs = await db.all(
    `SELECT m.* FROM ai_proposal_messages m
     ORDER BY m.proposal_id, m.created_at ASC, m.id ASC
     LIMIT 2000`,
  );

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name_join, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC
     LIMIT 200`,
  );

  const threads = await db.all(
    `SELECT m.* FROM feedback_messages m
     WHERE m.feedback_id IN (
       SELECT id FROM feedback WHERE status IN ('open','awaiting_approval')
     )
     ORDER BY m.feedback_id, m.created_at ASC, m.id ASC
     LIMIT 2000`,
  );

  res.json({ proposals, proposalMsgs, feedback, threads });
}));

// GET /api/diag/daily-j6ofvs/write?s=j6ofvs&action=...
// Все write-операции через GET (Vercel MCP поддерживает только GET).
// action=feedback-msg     : feedback_id, text
// action=patch-feedback   : id, status (опц), admin_reply (опц)
// action=close-feedback   : id, text (постит сообщение от AI и ставит closed)
// action=create-proposal  : feedback_id (опц), title, summary, category, risk, source, proposed_changes (JSON-строка)
// action=patch-proposal   : id, decision
// action=post-proposal-msg: proposal_id, text
router.get('/write', asyncHandler(async (req, res) => {
  const { action } = req.query;

  if (action === 'feedback-msg') {
    const { feedback_id, text } = req.query;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
      Number(feedback_id), String(text),
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'patch-feedback') {
    const { id, status, admin_reply } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const sets = [];
    const params = [];
    if (status) { sets.push('status = ?'); params.push(String(status)); }
    if (admin_reply !== undefined) { sets.push('admin_reply = ?'); params.push(String(admin_reply)); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push('updated_at = NOW()');
    params.push(Number(id));
    await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return res.json({ ok: true });
  }

  if (action === 'close-feedback') {
    const { id, text } = req.query;
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const numId = Number(id);
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
      numId, String(text),
    );
    await db.run(
      `UPDATE feedback SET status = 'closed', updated_at = NOW() WHERE id = ?`,
      numId,
    );
    return res.json({ ok: true });
  }

  if (action === 'create-proposal') {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    let changesJson = null;
    if (proposed_changes) {
      try { changesJson = JSON.stringify(JSON.parse(String(proposed_changes))); } catch { changesJson = null; }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      String(title), String(summary),
      category ? String(category) : null,
      risk || 'medium',
      source ? String(source) : null,
      changesJson,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (action === 'patch-proposal') {
    const { id, decision } = req.query;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      String(decision), Number(id),
    );
    return res.json({ ok: true });
  }

  if (action === 'post-proposal-msg') {
    const { proposal_id, text } = req.query;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      Number(proposal_id), String(text),
    );
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

// GET /api/diag/daily-j6ofvs/feedback-one?s=j6ofvs&id=N
// Возвращает одно обращение с тредом (в т.ч. закрытые)
router.get('/feedback-one', asyncHandler(async (req, res) => {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const fb = await db.get(
    `SELECT f.*, u.name AS user_name_join, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?`, id,
  );
  const thread = await db.all(
    `SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`, id,
  );
  res.json({ feedback: fb, thread });
}));

export default router;
