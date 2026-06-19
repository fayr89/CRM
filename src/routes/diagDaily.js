// TEMP — удалить после использования. AI daily-run 2026-06-19 p3w7ks
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'p3w7ks';
const router = Router();

router.use((req, res, next) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET — всё что нужно для ежедневного обхода одним запросом
router.get('/', asyncHandler(async (_req, res) => {
  const approved = await db.all("SELECT * FROM ai_proposals WHERE status='approved' ORDER BY created_at");
  const revision = await db.all("SELECT * FROM ai_proposals WHERE status='revision' ORDER BY created_at");
  const rejected = await db.all("SELECT * FROM ai_proposals WHERE status='rejected' ORDER BY created_at");
  const pending  = await db.all("SELECT * FROM ai_proposals WHERE status='pending'  ORDER BY created_at");

  const allProposals = [...approved, ...revision, ...rejected, ...pending];
  const proposalMessages = {};
  for (const p of allProposals) {
    proposalMessages[p.id] = await db.all(
      'SELECT id,user_name,role,text,created_at FROM ai_proposal_messages WHERE proposal_id=? ORDER BY created_at,id',
      p.id,
    );
  }

  const feedbackList = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.updated_at DESC`,
  );

  const feedbackMessages = {};
  for (const f of feedbackList) {
    feedbackMessages[f.id] = await db.all(
      'SELECT id,user_id,user_name,role,text,created_at FROM feedback_messages WHERE feedback_id=? ORDER BY created_at,id',
      f.id,
    );
  }

  res.json({ proposals: { approved, revision, rejected, pending }, proposalMessages, feedback: feedbackList, feedbackMessages });
}));

// POST /proposals — создать ai_proposal
router.post('/proposals', asyncHandler(async (req, res) => {
  const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
     VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
    feedback_id ?? null, title, summary, category ?? null,
    risk || 'medium', source ?? null,
    proposed_changes ? JSON.stringify(proposed_changes) : null,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /proposals/:id — decision (done/approved/rejected/revision)
router.patch('/proposals/:id', asyncHandler(async (req, res) => {
  const { decision, notes } = req.body;
  await db.run(
    'UPDATE ai_proposals SET status=?,admin_notes=?,updated_at=NOW() WHERE id=?',
    decision, notes ?? null, req.params.id,
  );
  res.json({ ok: true });
}));

// POST /proposals/:id/messages — сообщение в тред предложения
router.post('/proposals/:id/messages', asyncHandler(async (req, res) => {
  const { text, user_name } = req.body;
  const r = await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id,user_id,user_name,role,text)
     VALUES (?,NULL,?,'admin',?) RETURNING id`,
    req.params.id, user_name || 'AI ассистент', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// POST /feedback/:id/message — сообщение в тред обращения
router.post('/feedback/:id/message', asyncHandler(async (req, res) => {
  const { text, user_name, role } = req.body;
  const r = await db.run(
    `INSERT INTO feedback_messages (feedback_id,user_id,user_name,role,text)
     VALUES (?,NULL,?,?,?) RETURNING id`,
    req.params.id, user_name || 'AI ассистент', role || 'admin', text,
  );
  res.status(201).json({ id: r.lastInsertRowid });
}));

// PATCH /feedback/:id — статус обращения и admin_reply
router.patch('/feedback/:id', asyncHandler(async (req, res) => {
  const { status, admin_reply } = req.body;
  const sets = []; const vals = [];
  if (status)             { sets.push('status=?');       vals.push(status); }
  if (admin_reply !== undefined) { sets.push('admin_reply=?'); vals.push(admin_reply); }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at=NOW()');
  vals.push(req.params.id);
  await db.run(`UPDATE feedback SET ${sets.join(',')} WHERE id=?`, ...vals);
  res.json({ ok: true });
}));

export default router;
