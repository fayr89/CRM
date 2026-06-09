// TEMP: ежедневный AI-обход обращений. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'c4e9a2f7b1d6c4e9a2f7b1d6c4e9a2f7';
const VERSION = 'v60';

function checkToken(req, res) {
  if (req.query.token !== SECRET) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /api/diag/daily-run?token=SECRET
// Возвращает все данные для ежедневного обхода:
// - ai_proposals (approved, revision, rejected, pending) + их треды
// - feedback (open, awaiting_approval) + треды
router.get(
  '/daily-run',
  asyncHandler(async (req, res) => {
    if (!checkToken(req, res)) return;

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                p.created_at DESC
       LIMIT 100`,
    );

    const proposalMessages = {};
    for (const p of proposals) {
      const msgs = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalMessages[p.id] = msgs;
    }

    const feedbacks = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
              f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
                f.created_at DESC
       LIMIT 100`,
    );

    const feedbackMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      feedbackMessages[fb.id] = msgs;
    }

    res.json({
      version: VERSION,
      generated_at: new Date().toISOString(),
      proposals: proposals.map((p) => ({ ...p, messages: proposalMessages[p.id] || [] })),
      feedbacks: feedbacks.map((f) => ({ ...f, messages: feedbackMessages[f.id] || [] })),
    });
  }),
);

// GET /api/diag/daily-run/act?token=SECRET&op=...
// Выполняет одно действие.
//
// op=post-fb-msg   feedback_id=N  text=URL-encoded
// op=patch-fb      feedback_id=N  status=...  reply=URL-encoded (необязательный)
// op=post-proposal-msg  proposal_id=N  text=URL-encoded
// op=patch-proposal     proposal_id=N  decision=done|approved|rejected|revision
// op=create-proposal    title=...  summary=...  category=...  risk=...
//                        feedback_id=N(opt)  source=...
router.get(
  '/daily-run/act',
  asyncHandler(async (req, res) => {
    if (!checkToken(req, res)) return;
    const op = req.query.op;

    const admin = await db.get(`SELECT id, name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
    const adminId = admin?.id || null;

    if (op === 'post-fb-msg') {
      const fbId = Number(req.query.feedback_id);
      const text = String(req.query.text || '').trim();
      if (!fbId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fbId);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        fbId, adminId, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-fb') {
      const fbId = Number(req.query.feedback_id);
      const status = req.query.status ? String(req.query.status).trim() : null;
      const reply = req.query.reply ? String(req.query.reply).trim() : null;
      if (!fbId) return res.status(400).json({ error: 'feedback_id required' });
      const allowed = ['open', 'in_progress', 'awaiting_approval', 'closed'];
      if (status && !allowed.includes(status)) return res.status(400).json({ error: 'bad status' });
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           resolved_by = CASE WHEN ? IN ('awaiting_approval','closed') THEN ? ELSE resolved_by END,
           resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = ?`,
        status, reply,
        status, adminId,
        status,
        fbId,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal-msg') {
      const propId = Number(req.query.proposal_id);
      const text = String(req.query.text || '').trim();
      if (!propId || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const p = await db.get('SELECT id FROM ai_proposals WHERE id = ?', propId);
      if (!p) return res.status(404).json({ error: 'proposal not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        propId, adminId, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-proposal') {
      const propId = Number(req.query.proposal_id);
      const decision = req.query.decision ? String(req.query.decision).trim() : null;
      if (!propId || !decision) return res.status(400).json({ error: 'proposal_id and decision required' });
      const allowed = ['approved', 'rejected', 'revision', 'done'];
      if (!allowed.includes(decision)) return res.status(400).json({ error: 'bad decision' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, adminId, propId,
      );
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const title = String(req.query.title || '').trim();
      const summary = String(req.query.summary || '').trim();
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const category = req.query.category ? String(req.query.category).trim() : 'feature';
      const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
      const source = req.query.source ? String(req.query.source).trim() : `daily-run-${new Date().toISOString().slice(0, 10)}`;
      const fbId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      let proposedChanges = null;
      if (req.query.proposed_changes) {
        try { proposedChanges = JSON.parse(req.query.proposed_changes); } catch { /* ignore */ }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        fbId ?? null, title, summary, category, risk, source,
        proposedChanges ? JSON.stringify(proposedChanges) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op', ops: ['post-fb-msg', 'patch-fb', 'post-proposal-msg', 'patch-proposal', 'create-proposal'] });
  }),
);

export default router;
