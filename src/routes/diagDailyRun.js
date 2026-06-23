// ВРЕМЕННЫЙ диаг-эндпоинт для ежедневного обхода AI-ассистента.
// УДАЛИТЬ сразу после обхода отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr2026-0623-m7p4';

function chk(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run — полный дамп: ai_proposals + feedback с тредами
router.get('/', asyncHandler(async (req, res) => {
  if (!chk(req, res)) return;

  const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
  const adminId = admin?.id || 1;

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
               WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
              p.created_at DESC`,
  );

  if (proposals.length) {
    const pIds = proposals.map((p) => p.id);
    const pMsgs = await db.all(
      `SELECT id, proposal_id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages
       WHERE proposal_id IN (${pIds.join(',')})
       ORDER BY proposal_id, created_at ASC, id ASC`,
    );
    const pThreads = {};
    for (const m of pMsgs) {
      (pThreads[m.proposal_id] = pThreads[m.proposal_id] || []).push(m);
    }
    for (const p of proposals) p.messages = pThreads[p.id] || [];
  } else {
    for (const p of proposals) p.messages = [];
  }

  const feedbackList = await db.all(
    `SELECT f.id, f.status, f.category, f.subject, f.message, f.context,
            f.admin_reply, f.resolved_at, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );

  if (feedbackList.length) {
    const fIds = feedbackList.map((f) => f.id);
    const fMsgs = await db.all(
      `SELECT id, feedback_id, user_id, user_name, role, text, created_at
       FROM feedback_messages
       WHERE feedback_id IN (${fIds.join(',')})
       ORDER BY feedback_id, created_at ASC, id ASC`,
    );
    const fThreads = {};
    for (const m of fMsgs) {
      (fThreads[m.feedback_id] = fThreads[m.feedback_id] || []).push(m);
    }
    for (const f of feedbackList) f.messages = fThreads[f.id] || [];
  } else {
    for (const f of feedbackList) f.messages = [];
  }

  res.json({ admin_id: adminId, ai_proposals: proposals, feedback: feedbackList, ts: new Date().toISOString() });
}));

// GET /api/diag/daily-run/act — выполнить действие (GET т.к. Vercel MCP только GET)
router.get('/act', asyncHandler(async (req, res) => {
  if (!chk(req, res)) return;

  const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
  const adminId = admin?.id || 1;
  const { op } = req.query;

  if (op === 'patch_proposal') {
    // ?op=patch_proposal&id=N&decision=done|approved|rejected|revision&notes=...
    const { id, decision, notes } = req.query;
    await db.run(
      `UPDATE ai_proposals SET status=?, admin_notes=COALESCE(?,admin_notes),
       admin_decision_by=?, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
      decision, notes || null, adminId, Number(id),
    );
    res.json({ ok: true, id, decision });

  } else if (op === 'post_proposal') {
    // ?op=post_proposal&data=<base64 JSON>
    const data = JSON.parse(Buffer.from(req.query.data, 'base64url').toString('utf8'));
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
       VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
      data.feedback_id ?? null, data.title, data.summary,
      data.category ?? null, data.risk || 'medium', data.source ?? null,
      data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
    );
    res.status(201).json({ ok: true, id: r.lastInsertRowid });

  } else if (op === 'post_proposal_msg') {
    // ?op=post_proposal_msg&id=N&text=<urlencoded>
    const { id, text } = req.query;
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id,user_id,user_name,role,text)
       VALUES (?,?,'AI ассистент','admin',?)`,
      Number(id), adminId, decodeURIComponent(text),
    );
    res.json({ ok: true });

  } else if (op === 'patch_feedback') {
    // ?op=patch_feedback&id=N&status=awaiting_approval|closed|open&reply=<urlencoded>
    const { id, status, reply } = req.query;
    const cur = await db.get('SELECT status FROM feedback WHERE id=?', Number(id));
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status || cur.status;
    const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
      && !['awaiting_approval', 'closed'].includes(cur.status);
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?,admin_reply),
       resolved_by=COALESCE(resolved_by,?),
       resolved_at=${justResolved ? 'NOW()' : 'resolved_at'},
       updated_at=NOW() WHERE id=?`,
      newStatus, reply ? decodeURIComponent(reply) : null, adminId, Number(id),
    );
    res.json({ ok: true });

  } else if (op === 'post_feedback_msg') {
    // ?op=post_feedback_msg&id=N&text=<urlencoded>&uname=<urlencoded>
    const { id, text, uname } = req.query;
    await db.run(
      `INSERT INTO feedback_messages (feedback_id,user_id,user_name,role,text)
       VALUES (?,?,?,'admin',?)`,
      Number(id), adminId,
      uname ? decodeURIComponent(uname) : 'AI ассистент',
      decodeURIComponent(text),
    );
    res.json({ ok: true });

  } else {
    res.status(400).json({ error: 'unknown op', available: ['patch_proposal','post_proposal','post_proposal_msg','patch_feedback','post_feedback_msg'] });
  }
}));

export default router;
