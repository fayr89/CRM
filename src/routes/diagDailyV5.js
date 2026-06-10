// TEMP — ежедневный обход AI (v5). Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-2026-06-10-v5-r8nq2wsx';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET ?secret=...&action=list-proposals[&status=X]
// GET ?secret=...&action=list-feedback
// GET ?secret=...&action=proposal-messages&id=N
// GET ?secret=...&action=pending-proposals
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const { action } = req.query;

    if (action === 'list-proposals') {
      const where = req.query.status ? 'WHERE status = $1' : '';
      const params = req.query.status ? [req.query.status] : [];
      const rows = await db.all(
        `SELECT * FROM ai_proposals ${where} ORDER BY created_at DESC LIMIT 100`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (action === 'pending-proposals') {
      const rows = await db.all(
        `SELECT id, title, status, feedback_id, updated_at FROM ai_proposals WHERE status = 'pending' ORDER BY updated_at DESC LIMIT 50`,
      );
      const result = [];
      for (const p of rows) {
        const msgs = await db.all(
          `SELECT id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
          p.id,
        );
        result.push({ ...p, messages: msgs });
      }
      return res.json({ data: result });
    }

    if (action === 'list-feedback') {
      const items = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.updated_at DESC LIMIT 100`,
      );
      const result = [];
      for (const fb of items) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    if (action === 'proposal-messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /write?secret=...&action=...&params=JSON — для Vercel MCP (только GET)
router.get('/write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const action = req.query.action;
  let params = {};
  try { params = JSON.parse(req.query.params || '{}'); } catch { return res.status(400).json({ error: 'bad params json' }); }
  try {
    if (action === 'patch_proposal') {
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        params.decision, Number(params.id),
      );
      return res.json({ ok: true });
    }
    if (action === 'post_proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
        params.title,
        params.summary,
        params.category || 'feature',
        params.risk || 'medium',
        params.source || 'daily-run-2026-06-10',
        params.proposed_changes ? JSON.stringify(params.proposed_changes) : null,
        params.feedback_id || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'post_proposal_message') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at) VALUES (?, 'AI ассистент', ?, NOW())`,
        Number(params.proposal_id), params.text,
      );
      return res.json({ ok: true });
    }
    if (action === 'patch_feedback') {
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        params.status, params.admin_reply || null, Number(params.id),
      );
      return res.json({ ok: true });
    }
    if (action === 'post_feedback_message') {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at) VALUES (?, ?, 'admin', ?, NOW())`,
        Number(params.feedback_id), params.user_name || 'AI ассистент', params.text,
      );
      await db.run(`UPDATE feedback SET updated_at = NOW() WHERE id = ?`, Number(params.feedback_id));
      return res.json({ ok: true });
    }
    if (action === 'close_feedback') {
      await db.run(
        `UPDATE feedback SET status = 'closed', admin_reply = ?, updated_at = NOW() WHERE id = ?`,
        params.reason || 'Закрыто AI', Number(params.id),
      );
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
