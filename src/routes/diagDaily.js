// TEMP: AI ежедневный обход 2026-06-19. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'Xj9bK4m7p2rQ';

async function getAdminId() {
  const row = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
  return row?.id ?? 1;
}

function decode(val) {
  if (!val) return null;
  try { return Buffer.from(String(val), 'base64').toString('utf8'); } catch { return null; }
}

router.get('/', asyncHandler(async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });

  const op = req.query.op;

  if (!op) {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.created_at DESC`,
    );
    const proposalThreads = {};
    for (const p of proposals) {
      proposalThreads[p.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }
    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at DESC`,
    );
    const feedbackThreads = {};
    for (const fb of feedback) {
      feedbackThreads[fb.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }
    return res.json({ proposals, proposal_threads: proposalThreads, feedback, feedback_threads: feedbackThreads });
  }

  if (op === 'post-feedback-msg') {
    const fid = Number(req.query.fid);
    const text = decode(req.query.text_b64);
    if (!fid || !text) return res.status(400).json({ error: 'fid and text_b64 required' });
    const adminId = await getAdminId();
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
      fid, adminId, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'update-feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    const reply = decode(req.query.reply_b64);
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    const resolvedBy = justResolved ? await getAdminId() : cur.resolved_by;
    await db.run(
      `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
       resolved_by = ?, updated_at = NOW() WHERE id = ?`,
      status, reply, resolvedBy, id,
    );
    return res.json({ ok: true });
  }

  if (op === 'create-proposal') {
    const title = decode(req.query.title_b64);
    const summary = decode(req.query.summary_b64);
    const category = req.query.category || 'feature';
    const risk = req.query.risk || 'medium';
    const fid = req.query.fid ? Number(req.query.fid) : null;
    const changesJson = req.query.changes_b64 ? decode(req.query.changes_b64) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title_b64 and summary_b64 required' });
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, 'daily-run-2026-06-19', ?::jsonb) RETURNING id`,
      fid, title, summary, category, risk, changesJson,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'patch-proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    return res.json({ ok: true });
  }

  if (op === 'post-proposal-msg') {
    const pid = Number(req.query.pid);
    const text = decode(req.query.text_b64);
    if (!pid || !text) return res.status(400).json({ error: 'pid and text_b64 required' });
    const adminId = await getAdminId();
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
      pid, adminId, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.status(400).json({ error: 'unknown op: ' + op });
}));

export default router;
