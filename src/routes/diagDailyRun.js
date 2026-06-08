// TEMP: ежедневный AI-обход. Снести отдельным коммитом сразу после использования.
// v38 — 2026-06-08
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'ai-daily-2026-06-08-v38-7x9k4m2p';

function checkSecret(req, res) {
  if (req.query.token !== SECRET && req.body?.token !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?token=... — полный дамп для ежедневного обхода
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    // Предложения по статусам
    const approved = await db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY updated_at DESC`);
    const revision = await db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY updated_at DESC`);
    const rejected = await db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY updated_at DESC`);
    const pending  = await db.all(`SELECT * FROM ai_proposals WHERE status = 'pending'  ORDER BY created_at DESC`);

    // Треды предложений (только для approved/revision/rejected/pending)
    const allPropIds = [...approved, ...revision, ...rejected, ...pending].map((p) => p.id);
    const propMessages = allPropIds.length
      ? await db.all(
          `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(?::int[]) ORDER BY created_at ASC, id ASC`,
          allPropIds,
        )
      : [];
    const propMsgMap = {};
    for (const m of propMessages) {
      if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
      propMsgMap[m.proposal_id].push(m);
    }
    const attachMessages = (arr) => arr.map((p) => ({ ...p, messages: propMsgMap[p.id] || [] }));

    // Обращения: все open + awaiting_approval
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
    );

    // Треды обращений
    const fbIds = feedbacks.map((f) => f.id);
    const fbMessages = fbIds.length
      ? await db.all(
          `SELECT id, feedback_id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ANY(?::int[]) ORDER BY created_at ASC, id ASC`,
          fbIds,
        )
      : [];
    const fbMsgMap = {};
    for (const m of fbMessages) {
      if (!fbMsgMap[m.feedback_id]) fbMsgMap[m.feedback_id] = [];
      fbMsgMap[m.feedback_id].push(m);
    }

    const adminUser = await db.get(`SELECT id, name FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);

    res.json({
      run_date: new Date().toISOString(),
      admin_user: adminUser,
      proposals: {
        approved: attachMessages(approved),
        revision: attachMessages(revision),
        rejected: attachMessages(rejected),
        pending:  attachMessages(pending),
      },
      feedbacks: feedbacks.map((f) => ({ ...f, messages: fbMsgMap[f.id] || [] })),
    });
  }),
);

// POST /api/diag/daily-run/proposal?token=... — создать ai_proposal
router.post(
  '/proposal',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary,
      category ?? null, risk ?? 'medium', source ?? null,
      proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  }),
);

// PATCH /api/diag/daily-run/proposal/:id?token=... — сменить статус предложения
router.patch(
  '/proposal/:id',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { decision, notes } = req.body;
    const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?,
       admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, notes ?? null, adminUser?.id ?? null, req.params.id,
    );
    res.json({ ok: true });
  }),
);

// POST /api/diag/daily-run/proposal/:id/message?token=... — сообщение в тред предложения
router.post(
  '/proposal/:id/message',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { text, user_name } = req.body;
    const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
      req.params.id, adminUser?.id ?? null, user_name || 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  }),
);

// POST /api/diag/daily-run/feedback/:id/message?token=... — ответить в тред обращения
router.post(
  '/feedback/:id/message',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { text, user_name } = req.body;
    const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
      req.params.id, adminUser?.id ?? null, user_name || 'AI ассистент', text,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  }),
);

// PATCH /api/diag/daily-run/feedback/:id/status?token=... — сменить статус обращения
router.patch(
  '/feedback/:id/status',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;
    const { status, admin_reply } = req.body;
    const adminUser = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    const cur = await db.get('SELECT status, user_id FROM feedback WHERE id = ?', req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = COALESCE(?, resolved_by),
         resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
         updated_at = NOW()
       WHERE id = ?`,
      status, admin_reply ?? null, justResolved ? (adminUser?.id ?? null) : null, req.params.id,
    );
    res.json({ ok: true });
  }),
);

export default router;
