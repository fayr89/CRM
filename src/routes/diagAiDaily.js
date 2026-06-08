// TEMP: ежедневный AI-обход (2026-06-08-v37). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'ai-daily-2026-06-08-v37';

function guard(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /api/diag/ai-daily/data — все предложения + все открытые обращения с тредами
router.get('/data', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.status AS feedback_status
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
              WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
              p.created_at DESC`,
  );

  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = $1
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name_join, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );

  const feedbackMessages = {};
  for (const fb of feedback) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = $1
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    feedbackMessages[fb.id] = msgs;
  }

  const adminUser = await db.get(`SELECT id, name FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);

  res.json({ proposals, proposalMessages, feedback, feedbackMessages, adminUser });
}));

// GET-based write routes (Vercel MCP — GET only)

// GET /api/diag/ai-daily/w/fb-msg?token=SECRET&id=N&text=...
router.get('/w/fb-msg', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const text = String(req.query.text || '');
  if (!id || !text) { res.status(400).json({ error: 'id and text required' }); return; }
  const fb = await db.get('SELECT id FROM feedback WHERE id = $1', id);
  if (!fb) { res.status(404).json({ error: 'feedback not found' }); return; }
  await db.run(
    `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
     VALUES ($1, NULL, 'AI ассистент', 'admin', $2)`,
    id, text,
  );
  res.json({ ok: true });
}));

// GET /api/diag/ai-daily/w/fb-status?token=SECRET&id=N&status=...&admin_reply=...
router.get('/w/fb-status', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const newStatus = String(req.query.status || '');
  const adminReply = req.query.admin_reply ? String(req.query.admin_reply) : null;
  if (!id || !newStatus) { res.status(400).json({ error: 'id and status required' }); return; }
  const cur = await db.get('SELECT * FROM feedback WHERE id = $1', id);
  if (!cur) { res.status(404).json({ error: 'not found' }); return; }
  const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
    && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
  await db.run(
    `UPDATE feedback SET
       status = $1,
       admin_reply = COALESCE($2, admin_reply),
       resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at = NOW()
     WHERE id = $3`,
    newStatus, adminReply, id,
  );
  res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = $1', id));
}));

// GET /api/diag/ai-daily/w/proposal-msg?token=SECRET&id=N&text=...
router.get('/w/proposal-msg', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const text = String(req.query.text || '');
  if (!id || !text) { res.status(400).json({ error: 'id and text required' }); return; }
  await db.run(
    `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at)
     VALUES ($1, 'AI ассистент', 'ai', $2, NOW())`,
    id, text,
  );
  res.json({ ok: true });
}));

// GET /api/diag/ai-daily/w/proposal-status?token=SECRET&id=N&decision=done
router.get('/w/proposal-status', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const id = Number(req.query.id);
  const decision = String(req.query.decision || '');
  if (!id || !decision) { res.status(400).json({ error: 'id and decision required' }); return; }
  await db.run(`UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`, decision, id);
  res.json(await db.get('SELECT id, status FROM ai_proposals WHERE id = $1', id));
}));

// GET /api/diag/ai-daily/w/new-proposal?token=SECRET&title=...&summary=...&category=...&risk=...&feedback_id=...
router.get('/w/new-proposal', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const q = req.query;
  const row = await db.get(
    `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', NOW(), NOW()) RETURNING id, title, status`,
    String(q.title || ''),
    String(q.summary || ''),
    q.category || 'feature',
    q.risk || 'medium',
    'daily-run-2026-06-08-v37',
    q.feedback_id ? Number(q.feedback_id) : null,
    JSON.stringify(q.proposed_changes ? JSON.parse(q.proposed_changes) : []),
  );
  res.status(201).json(row);
}));

export default router;
