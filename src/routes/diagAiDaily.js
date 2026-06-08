// TEMP: ежедневный AI-обход (2026-06-08-v36). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'ai-daily-2026-06-08-v36';

function guard(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /api/diag/ai-daily/data — все предложения + все открытые обращения с тредами
router.get('/data', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;

  // Все ai_proposals по нужным статусам
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

  // Треды всех proposals
  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  // Feedback: open + awaiting_approval
  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.created_at DESC`,
  );

  // Треды всех feedback
  const feedbackMessages = {};
  for (const fb of feedback) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    feedbackMessages[fb.id] = msgs;
  }

  // Первый admin для операций
  const adminUser = await db.get(`SELECT id, name FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);

  res.json({ proposals, proposalMessages, feedback, feedbackMessages, adminUser });
}));

// POST /api/diag/ai-daily/action — выполнить действие
router.post('/action', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return;
  const { type, ...params } = req.body || {};
  const admin = await db.get(`SELECT id, name FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
  if (!admin) return res.status(500).json({ error: 'no admin user found' });

  if (type === 'patch_proposal') {
    // { id, decision, notes? }
    const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', params.id);
    if (!cur) return res.status(404).json({ error: 'proposal not found' });
    await db.run(
      `UPDATE ai_proposals SET status=?, admin_notes=COALESCE(?,admin_notes),
       admin_decision_by=?, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
      params.decision, params.notes ?? null, admin.id, cur.id,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id=?', cur.id));
  }

  if (type === 'create_proposal') {
    // { feedback_id?, title, summary, category?, risk?, source?, proposed_changes? }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
       VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
      params.feedback_id ?? null, params.title, params.summary,
      params.category ?? null, params.risk || 'medium', params.source ?? null,
      params.proposed_changes ? JSON.stringify(params.proposed_changes) : null,
    );
    return res.status(201).json(await db.get('SELECT * FROM ai_proposals WHERE id=?', r.lastInsertRowid));
  }

  if (type === 'proposal_message') {
    // { id, text }
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id,user_id,user_name,role,text)
       VALUES (?,?,?,?,?) RETURNING id`,
      params.id, admin.id, 'AI ассистент', 'admin', params.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  if (type === 'patch_feedback') {
    // { id, status?, admin_reply? }
    const cur = await db.get('SELECT * FROM feedback WHERE id=?', params.id);
    if (!cur) return res.status(404).json({ error: 'feedback not found' });
    const newStatus = params.status ?? cur.status;
    const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?,admin_reply),
       resolved_by=?, resolved_at=${justResolved ? 'NOW()' : 'resolved_at'}, updated_at=NOW()
       WHERE id=?`,
      newStatus, params.admin_reply ?? null,
      justResolved ? admin.id : cur.resolved_by,
      cur.id,
    );
    return res.json(await db.get('SELECT * FROM feedback WHERE id=?', cur.id));
  }

  if (type === 'feedback_message') {
    // { id, text }
    const fb = await db.get('SELECT id FROM feedback WHERE id=?', params.id);
    if (!fb) return res.status(404).json({ error: 'feedback not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id,user_id,user_name,role,text)
       VALUES (?,?,?,?,?) RETURNING id`,
      fb.id, admin.id, 'AI ассистент', 'admin', params.text,
    );
    return res.status(201).json({ id: r.lastInsertRowid });
  }

  res.status(400).json({ error: `unknown type: ${type}` });
}));

export default router;
