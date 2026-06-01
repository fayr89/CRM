// --- TEMP: AI daily finalize (сессия qnBGo-2, удалить после использования) ---
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const TOKEN = 'f3c9d1e8a27b4560e1d2f8c3b9a04751e6d7f290c1b3e485';

function auth(req, res, next) {
  if (req.query.token !== TOKEN) return res.status(403).json({ error: 'forbidden' });
  next();
}

// GET /api/diag/status?token=... — proposals + open feedbacks
router.get('/status', auth, async (req, res) => {
  const proposals = await db.all(
    `SELECT id, title, status, decision, feedback_id FROM ai_proposals ORDER BY id`
  );
  const feedbacks = await db.all(
    `SELECT f.id, f.status, f.subject, f.admin_reply,
            (SELECT json_agg(m ORDER BY m.created_at) FROM feedback_messages m WHERE m.feedback_id=f.id) AS messages
     FROM feedback f WHERE f.status NOT IN ('closed') ORDER BY f.id`
  );
  res.json({ proposals, feedbacks });
});

// GET /api/diag/patch-proposal?token=...&id=X&decision=done
router.get('/patch-proposal', auth, async (req, res) => {
  const { id, decision } = req.query;
  if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
  const statusMap = { done: 'done', approved: 'approved', rejected: 'rejected', revision: 'revision' };
  const status = statusMap[decision] || decision;
  await db.run(`UPDATE ai_proposals SET status=?, decision=? WHERE id=?`, [status, decision, id]);
  res.json({ ok: true, id, status, decision });
});

// GET /api/diag/patch-feedback?token=...&id=X&status=...&reply=...
router.get('/patch-feedback', auth, async (req, res) => {
  const { id, status, reply } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });
  const fields = [];
  const vals = [];
  if (status) { fields.push('status=?'); vals.push(status); }
  if (reply !== undefined) { fields.push('admin_reply=?'); vals.push(reply); }
  if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
  fields.push('updated_at=NOW()');
  vals.push(id);
  await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id=?`, vals);
  res.json({ ok: true, id, status, reply });
});

// GET /api/diag/post-msg?token=...&fid=X&text=...
router.get('/post-msg', auth, async (req, res) => {
  const { fid, text } = req.query;
  if (!fid || !text) return res.status(400).json({ error: 'fid and text required' });
  const row = await db.get(
    `INSERT INTO feedback_messages (feedback_id, user_name, role, message, created_at)
     VALUES (?, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
    [fid, text]
  );
  res.json({ ok: true, id: row?.id });
});

export default router;
// --- END TEMP ---
