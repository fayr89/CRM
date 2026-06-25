// TEMPORARY — удалить после использования. Только для ежедневного AI-обхода.
// Секрет в query ?s=... даёт обход JWT-аутентификации (только GET).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const DIAG_SECRET = 'r4t8m1w6z9q3';
const router = Router();

router.use((req, res, next) => {
  if (req.query?.s !== DIAG_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/ai-daily — всё нужное одним запросом
router.get('/', asyncHandler(async (_req, res) => {
  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name
     FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by
     ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END), p.created_at DESC
     LIMIT 200`,
  );
  const fbMsgs = await db.all(
    `SELECT feedback_id, id, user_id, user_name, role, text, created_at
     FROM feedback_messages
     WHERE feedback_id IN (
       SELECT id FROM feedback WHERE status IN ('open','awaiting_approval')
     )
     ORDER BY created_at ASC, id ASC`,
  );
  const pMsgs = await db.all(
    `SELECT proposal_id, id, user_id, user_name, role, text, created_at
     FROM ai_proposal_messages
     ORDER BY created_at ASC, id ASC
     LIMIT 500`,
  );
  res.json({ feedback, fb_messages: fbMsgs, proposals, proposal_messages: pMsgs });
}));

// GET /api/diag/ai-daily/write?s=SECRET&op=OP&... — мутации через GET
// (web_fetch_vercel_url поддерживает только GET)
router.get('/write', asyncHandler(async (req, res) => {
  const { op } = req.query;

  if (op === 'patch_feedback') {
    // ?op=patch_feedback&id=N&status=S&reply=TEXT
    const id = Number(req.query.id);
    const { status, reply } = req.query;
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
      && !['awaiting_approval', 'closed'].includes(cur.status);
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         resolved_by = CASE WHEN ? THEN 0 ELSE resolved_by END,
         resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
         updated_at = NOW()
       WHERE id = ?`,
      newStatus, reply ?? null, justResolved, justResolved, id,
    );
    return res.json(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id));
  }

  if (op === 'post_fb_msg') {
    // ?op=post_fb_msg&id=N&text=TEXT
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  if (op === 'create_proposal') {
    // ?op=create_proposal&feedback_id=N&title=T&summary=S&category=C&risk=R&source=SRC&changes=JSON
    const { feedback_id, title, summary, category, risk, source, changes } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title, summary, category ?? null, risk ?? 'medium', source ?? null,
      changes ?? null,
    );
    return res.json(await db.get('SELECT id, title, status FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (op === 'patch_proposal') {
    // ?op=patch_proposal&id=N&decision=done
    const id = Number(req.query.id);
    const { decision } = req.query;
    if (!decision) return res.status(400).json({ error: 'decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      decision, id,
    );
    return res.json(await db.get('SELECT id, status FROM ai_proposals WHERE id = ?', id));
  }

  if (op === 'post_proposal_msg') {
    // ?op=post_proposal_msg&id=N&text=TEXT
    const id = Number(req.query.id);
    const text = req.query.text;
    if (!text) return res.status(400).json({ error: 'text required' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, msg_id: r.lastInsertRowid });
  }

  res.status(400).json({ error: 'unknown op', valid_ops: ['patch_feedback','post_fb_msg','create_proposal','patch_proposal','post_proposal_msg'] });
}));

export default router;
