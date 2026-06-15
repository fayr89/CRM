// TEMP: временный эндпоинт для ежедневного AI-обхода.
// Удалить после завершения обхода отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'airun2026v20xp7';

router.use((req, res, next) => {
  if (req.query?.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET /api/diag/ai-run — дамп предложений + feedback с тредами
router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status || null;
  const proposalWhere = status ? `WHERE p.status = '${status.replace(/'/g, "''")}'` : '';

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     ${proposalWhere}
     ORDER BY p.created_at DESC
     LIMIT 200`,
  );

  for (const p of proposals) {
    p.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      p.id,
    );
  }

  const feedback = await db.all(
    `SELECT f.*, u.name AS user_name_join, u.email AS user_email, u.role AS user_role
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.updated_at DESC
     LIMIT 100`,
  );

  for (const f of feedback) {
    f.thread = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ?
       ORDER BY created_at ASC, id ASC`,
      f.id,
    );
  }

  res.json({ proposals, feedback });
}));

// GET /api/diag/ai-run/do?secret=X&op=OP&... — write-handler через GET
router.get('/do', asyncHandler(async (req, res) => {
  const q = req.query;
  const op = String(q.op || '');

  if (op === 'create-proposal') {
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      q.feedback_id ? Number(q.feedback_id) : null,
      String(q.title || '').slice(0, 200),
      String(q.summary || '').slice(0, 5000),
      q.category || null,
      q.risk || 'medium',
      q.source || null,
      q.proposed_changes || null,
    );
    return res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid));
  }

  if (op === 'patch-proposal') {
    const id = Number(q.id);
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      q.decision, id,
    );
    return res.json(await db.get('SELECT id, status FROM ai_proposals WHERE id = ?', id));
  }

  if (op === 'proposal-message') {
    const id = Number(q.id);
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, String(q.text || '').slice(0, 5000),
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'feedback-status') {
    const id = Number(q.id);
    const fields = ['updated_at = NOW()'];
    const vals = [];
    if (q.status) { fields.unshift('status = ?'); vals.push(q.status); }
    if (q.admin_reply !== undefined) { fields.splice(fields.length - 1, 0, 'admin_reply = ?'); vals.push(String(q.admin_reply || '').slice(0, 2000)); }
    vals.push(id);
    await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals);
    return res.json(await db.get('SELECT id, status, admin_reply, subject FROM feedback WHERE id = ?', id));
  }

  if (op === 'feedback-message') {
    const id = Number(q.id);
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?, NULL) RETURNING id`,
      id, String(q.text || '').slice(0, 5000),
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown op' });
}));

export default router;
