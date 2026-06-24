// TEMPORARY — ежедневный AI-обход. Снести сразу после использования.
// Секрет: разовый, только для этой сессии.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'v18_q7z4n3r1x9';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(checkSecret);

// GET /api/diag/daily-run-v5?secret=&part=feedback|proposals — данные для обхода
// part=feedback — обращения с тредами; part=proposals — предложения с тредами
router.get('/', asyncHandler(async (req, res) => {
  const part = req.query.part || 'feedback';

  if (part === 'feedback') {
    const feedback = await db.all(`
      SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
             f.created_at, f.updated_at,
             u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.created_at ASC
    `);
    const feedbackIds = feedback.map(f => f.id);
    let messages = [];
    if (feedbackIds.length) {
      messages = await db.all(`
        SELECT feedback_id, id, user_id, user_name, role, text, created_at
        FROM feedback_messages
        WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
        ORDER BY created_at ASC, id ASC
      `);
    }
    const msgByFeedback = {};
    for (const m of messages) {
      if (!msgByFeedback[m.feedback_id]) msgByFeedback[m.feedback_id] = [];
      msgByFeedback[m.feedback_id].push(m);
    }
    return res.json({
      part: 'feedback',
      feedback: feedback.map(f => ({ ...f, thread: msgByFeedback[f.id] || [] })),
      generated_at: new Date().toISOString(),
    });
  }

  if (part === 'proposals') {
    const proposals = await db.all(`
      SELECT p.id, p.feedback_id, p.title, p.summary, p.category, p.risk,
             p.source, p.status, p.admin_notes, p.created_at, p.updated_at,
             u.name AS admin_decision_by_name
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      WHERE p.status IN ('approved','rejected','revision','pending')
      ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END),
               p.created_at DESC
    `);
    const propIds = proposals.map(p => p.id);
    let propMessages = [];
    if (propIds.length) {
      propMessages = await db.all(`
        SELECT proposal_id, id, user_id, user_name, role, text, created_at
        FROM ai_proposal_messages
        WHERE proposal_id = ANY(ARRAY[${propIds.join(',')}]::int[])
        ORDER BY created_at ASC, id ASC
      `);
    }
    const propMsgById = {};
    for (const m of propMessages) {
      if (!propMsgById[m.proposal_id]) propMsgById[m.proposal_id] = [];
      propMsgById[m.proposal_id].push(m);
    }
    return res.json({
      part: 'proposals',
      proposals: proposals.map(p => ({ ...p, thread: propMsgById[p.id] || [] })),
      generated_at: new Date().toISOString(),
    });
  }

  return res.status(400).json({ error: 'part must be feedback or proposals' });
}));

// Все write-операции через GET с base64-кодированным JSON телом (параметр d=)
// Это нужно потому что Vercel MCP-tool поддерживает только GET.
// Формат: GET /api/diag/daily-run-v4/w?secret=...&d=<base64(JSON)>
// JSON: { op, ...params }
router.get('/w', asyncHandler(async (req, res) => {
  const raw = req.query.d;
  if (!raw) return res.status(400).json({ error: 'd param required (base64 JSON)' });
  let body;
  try {
    body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    return res.status(400).json({ error: 'invalid base64 JSON' });
  }
  const { op, ...data } = body;

  if (op === 'feedback_message') {
    const { feedback_id, text } = data;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id + text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedback_id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      feedback_id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'feedback_status') {
    const { feedback_id, status, admin_reply } = data;
    if (!feedback_id || !status) return res.status(400).json({ error: 'feedback_id + status required' });
    const valid = ['open', 'in_progress', 'awaiting_approval', 'closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'invalid status' });
    await db.run(
      `UPDATE feedback SET status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      status, admin_reply ?? null, feedback_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'ai_proposal_create') {
    const { title, summary, category, risk, source, feedback_id, proposed_changes } = data;
    if (!title || !summary) return res.status(400).json({ error: 'title + summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? 'feature', risk ?? 'medium',
      source ?? `daily-run-${new Date().toISOString().slice(0, 10)}`,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'ai_proposal_update') {
    const { proposal_id, status } = data;
    if (!proposal_id || !status) return res.status(400).json({ error: 'proposal_id + status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, proposal_id,
    );
    return res.json({ ok: true });
  }

  if (op === 'ai_proposal_message') {
    const { proposal_id, text } = data;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id + text required' });
    const prop = await db.get('SELECT id FROM ai_proposals WHERE id = ?', proposal_id);
    if (!prop) return res.status(404).json({ error: 'proposal not found' });
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
