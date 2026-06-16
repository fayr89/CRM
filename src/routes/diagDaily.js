// TEMP: ежедневный AI-обход. Удалить сразу после обхода.
// Все операции — GET с секретом в query?token=...
// POST-семантика кодируется через action= и параметры.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const TOKEN = 'f7Xm2nKp9qTs5vRw'; // одноразовый

function auth(req, res) {
  if (req.query.token !== TOKEN) {
    res.status(403).json({ error: 'bad token' });
    return false;
  }
  return true;
}

router.get('/', asyncHandler(async (req, res) => {
  if (!auth(req, res)) return;

  const action = req.query.action || 'read';

  // ── READ ALL ─────────────────────────────────────────────────────────────
  if (action === 'read') {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    const proposalMessages = {};
    for (const p of proposals) {
      proposalMessages[p.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const feedbackMessages = {};
    for (const fb of feedback) {
      feedbackMessages[fb.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }
    return res.json({ proposals, proposal_messages: proposalMessages, feedback, feedback_messages: feedbackMessages });
  }

  // ── MARK PROPOSAL DONE ───────────────────────────────────────────────────
  if (action === 'proposal_done') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    const cur = await db.get('SELECT id, status FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    await db.run(
      `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, id,
    );
    return res.json({ ok: true, id, prev_status: cur.status });
  }

  // ── CREATE PROPOSAL ───────────────────────────────────────────────────────
  if (action === 'proposal_create') {
    const title = req.query.title;
    const summary = req.query.summary;
    if (!title || !summary) return res.status(400).json({ error: 'title,summary required' });
    const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
    let changesJson = null;
    if (req.query.changes) {
      try { changesJson = JSON.stringify(JSON.parse(req.query.changes)); } catch { changesJson = null; }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedbackId,
      title,
      summary,
      req.query.category || null,
      req.query.risk || 'medium',
      req.query.source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
      changesJson,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  // ── ADD MESSAGE TO PROPOSAL ───────────────────────────────────────────────
  if (action === 'proposal_msg') {
    const pid = Number(req.query.pid);
    const text = req.query.text;
    if (!pid || !text) return res.status(400).json({ error: 'pid,text required' });
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', pid);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      pid, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  // ── ADD MESSAGE TO FEEDBACK ───────────────────────────────────────────────
  if (action === 'feedback_msg') {
    const fb_id = Number(req.query.fb);
    const text = req.query.text;
    if (!fb_id || !text) return res.status(400).json({ error: 'fb,text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fb_id);
    if (!fb) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      fb_id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  // ── UPDATE FEEDBACK STATUS ────────────────────────────────────────────────
  if (action === 'feedback_update') {
    const fb_id = Number(req.query.fb);
    const status = req.query.status;
    if (!fb_id || !status) return res.status(400).json({ error: 'fb,status required' });
    const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const cur = await db.get('SELECT id, status FROM feedback WHERE id = ?', fb_id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const adminReply = req.query.reply || null;
    await db.run(
      `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), updated_at=NOW() WHERE id=?`,
      status, adminReply, fb_id,
    );
    return res.json({ ok: true, id: fb_id, status });
  }

  return res.status(400).json({ error: 'unknown action' });
}));

export default router;
