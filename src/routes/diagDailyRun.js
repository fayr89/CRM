// TEMP: диагностический эндпоинт для ежедневного обхода AI (daily-run-2026-06-17-v59).
// Удалить после использования!
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr_v59_9pLw2qNz';

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /data — proposals + feedback с тредами
router.get('/data', asyncHandler(async (_req, res) => {
  const proposals = await db.all(
    `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     WHERE p.status IN ('approved','revision','rejected','pending')
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
  );
  const proposalIds = proposals.map((p) => p.id);
  const proposalMessages = proposalIds.length
    ? await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(?)
         ORDER BY created_at ASC, id ASC`,
        proposalIds,
      )
    : [];

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );
  const feedbackIds = feedback.map((f) => f.id);
  const feedbackMessages = feedbackIds.length
    ? await db.all(
        `SELECT id, feedback_id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ANY(?)
         ORDER BY created_at ASC, id ASC`,
        feedbackIds,
      )
    : [];

  res.json({ proposals, proposalMessages, feedback, feedbackMessages });
}));

// GET /op — write-операции через GET (MCP-среда без POST)
// op=feedback-message   feedback_id=N text=...
// op=feedback-status    feedback_id=N status=... admin_reply=...
// op=proposal           title=... summary=... category=... risk=... source=... feedback_id=N proposed_changes=JSON
// op=proposal-revision  proposal_id=N title=... summary=... category=... risk=...
// op=proposal-done      proposal_id=N
// op=proposal-message   proposal_id=N text=...
// op=proposal-status    proposal_id=N status=...
router.get('/op', asyncHandler(async (req, res) => {
  const { op } = req.query;

  if (op === 'feedback-message') {
    const feedback_id = Number(req.query.feedback_id);
    const text = String(req.query.text || '');
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'feedback-status') {
    const feedback_id = Number(req.query.feedback_id);
    const status = String(req.query.status || '');
    const admin_reply = req.query.admin_reply ? String(req.query.admin_reply) : null;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id and status required' });
    const cur = await db.get('SELECT id, status FROM feedback WHERE id = ?', feedback_id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_by = CASE WHEN $3 THEN 0 ELSE resolved_by END,
       resolved_at = CASE WHEN $3 THEN NOW() ELSE resolved_at END,
       updated_at = NOW() WHERE id = ?`,
      status, admin_reply, justResolved, feedback_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'proposal') {
    const { title, summary, category, risk, source } = req.query;
    const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    const proposed_changes = req.query.proposed_changes
      ? JSON.parse(String(req.query.proposed_changes)) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id,
      String(title),
      String(summary),
      category ? String(category) : null,
      risk ? String(risk) : 'medium',
      source ? String(source) : 'daily-run-2026-06-17',
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.status(201).json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'proposal-revision') {
    const proposal_id = Number(req.query.proposal_id);
    if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
    const fields = {};
    if (req.query.title) fields.title = String(req.query.title);
    if (req.query.summary) fields.summary = String(req.query.summary);
    if (req.query.category) fields.category = String(req.query.category);
    if (req.query.risk) fields.risk = String(req.query.risk);
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const vals = Object.values(fields);
    if (!sets) return res.status(400).json({ error: 'no fields' });
    await db.run(
      `UPDATE ai_proposals SET ${sets}, status = 'pending', updated_at = NOW() WHERE id = $${vals.length + 1}`,
      ...vals, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'proposal-done') {
    const proposal_id = Number(req.query.proposal_id);
    if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'done', admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      proposal_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'proposal-status') {
    const proposal_id = Number(req.query.proposal_id);
    const status = String(req.query.status || '');
    if (!proposal_id || !status) return res.status(400).json({ error: 'proposal_id and status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'proposal-message') {
    const proposal_id = Number(req.query.proposal_id);
    const text = String(req.query.text || '');
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      proposal_id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: `unknown op: ${op}` });
}));

export default router;
