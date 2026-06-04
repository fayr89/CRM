// TEMP daily-run diagnostic endpoint — remove after use (2026-06-04-v11)
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-20260604-v11-m3p8';

function guard(req, res) {
  if (req.query.s !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET /api/diag/daily?s=SECRET
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
                WHEN 'approved' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END,
                p.created_at DESC`,
    );
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const allMessages = feedbacks.length > 0
      ? await db.all(
          `SELECT fm.* FROM feedback_messages fm
           WHERE fm.feedback_id IN (SELECT id FROM feedback WHERE status IN ('open','awaiting_approval'))
           ORDER BY fm.feedback_id, fm.created_at ASC, fm.id ASC`,
        )
      : [];
    const msgMap = {};
    for (const m of allMessages) {
      if (!msgMap[m.feedback_id]) msgMap[m.feedback_id] = [];
      msgMap[m.feedback_id].push(m);
    }
    res.json({
      proposals,
      feedbacks: feedbacks.map(f => ({ ...f, messages: msgMap[f.id] || [] })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/act?s=SECRET&a=ACTION&...
router.get('/act', async (req, res) => {
  if (!guard(req, res)) return;
  const { a } = req.query;
  try {
    if (a === 'msg') {
      const fid = Number(req.query.fid);
      const text = req.query.text;
      if (!fid || !text) return res.status(400).json({ error: 'fid,text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        fid, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (a === 'upd-fb') {
      const fid = Number(req.query.fid);
      if (!fid) return res.status(400).json({ error: 'fid required' });
      const sets = [];
      const params = [];
      if (req.query.status) { sets.push('status = ?'); params.push(req.query.status); }
      if (req.query.reply) { sets.push('admin_reply = ?'); params.push(req.query.reply); }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      sets.push('updated_at = NOW()');
      params.push(fid);
      await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
      return res.json({ ok: true });
    }
    if (a === 'create-prop') {
      const { title, summary, risk, cat, fid, changes } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title,summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        fid ? Number(fid) : null,
        title, summary,
        cat || null,
        risk || 'medium',
        'daily-run-2026-06-04',
        changes || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (a === 'upd-prop') {
      const id = Number(req.query.id);
      const status = req.query.status;
      if (!id || !status) return res.status(400).json({ error: 'id,status required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        status, id,
      );
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: `unknown action: ${a}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
