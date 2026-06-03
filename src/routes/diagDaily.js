// Временный диагностический эндпоинт для ежедневного AI-обхода обращений.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const SECRET = 'ai-daily-2026-06-03-Rpu5B-x9k2';

const router = Router();

function auth(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// Читаем все обращения со статусом open/awaiting_approval + треды + ai_proposals
router.get('/', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const feedbacks = await db.all(
    `SELECT f.id, f.status, f.subject, f.message, f.category, f.context,
            f.admin_reply, f.created_at, f.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval')
     ORDER BY f.created_at DESC`,
  );
  for (const fb of feedbacks) {
    fb.messages = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
  }
  const approved = await db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`);
  const revision = await db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`);
  const rejected = await db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC`);
  res.json({ feedbacks, proposals: { approved, revision, rejected } });
}));

// Write-операции через GET (Vercel MCP поддерживает только GET)
// op=post-msg      fb_id, text
// op=update-fb     fb_id, status, reply (опционально)
// op=close-fb      fb_id, msg (опционально — итоговое сообщение в тред)
// op=create-proposal  title, summary, category, risk, source, feedback_id (опционально)
// op=done-proposal    proposal_id
router.get('/op', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;
  const { op } = req.query;

  if (op === 'post-msg') {
    const { fb_id, text } = req.query;
    if (!fb_id || !text) return res.status(400).json({ error: 'fb_id and text required' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      Number(fb_id), text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'update-fb') {
    const { fb_id, status, reply } = req.query;
    if (!fb_id) return res.status(400).json({ error: 'fb_id required' });
    const sets = ['updated_at = NOW()'];
    const params = [];
    if (status) { sets.push('status = ?'); params.push(status); }
    if (reply) { sets.push('admin_reply = ?'); params.push(reply); }
    params.push(Number(fb_id));
    await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
    return res.json({ ok: true });
  }

  if (op === 'close-fb') {
    const { fb_id, msg } = req.query;
    if (!fb_id) return res.status(400).json({ error: 'fb_id required' });
    await db.run(`UPDATE feedback SET status = 'closed', updated_at = NOW() WHERE id = ?`, Number(fb_id));
    if (msg) {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        Number(fb_id), msg,
      );
    }
    return res.json({ ok: true });
  }

  if (op === 'create-proposal') {
    const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const changesJson = proposed_changes ? proposed_changes : null;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ? Number(feedback_id) : null,
      title, summary,
      category || 'feature',
      risk || 'medium',
      source || 'daily-run-2026-06-03',
      changesJson,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'done-proposal') {
    const { proposal_id } = req.query;
    if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });
    await db.run(
      `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
      Number(proposal_id),
    );
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: `unknown op: ${op}` });
}));

export default router;
