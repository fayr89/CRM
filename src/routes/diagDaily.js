// TEMPORARY diag endpoint for AI daily run 2026-06-05-v42.
// DELETE this file after use.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'AI-D42-rK7m9p2026';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=X  — read all proposals + feedback with threads
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    // ai_proposals (all non-done statuses + pending)
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY p.created_at DESC`,
    );

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

    // feedback (open + awaiting_approval)
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.created_at DESC`,
    );

    const fbMessages = {};
    for (const fb of feedbacks) {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      fbMessages[fb.id] = msgs;
    }

    res.json({ proposals, proposal_messages: proposalMessages, feedbacks, fb_messages: fbMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily/act?secret=X&payload=BASE64  — execute one action
// payload = base64(JSON) of action object
router.get('/act', async (req, res) => {
  if (!guard(req, res)) return;
  let action;
  try {
    // Accept both standard base64 and URL-safe base64 (+ → -, / → _, = stripped)
    const raw = String(req.query.payload || '').replace(/-/g, '+').replace(/_/g, '/');
    action = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'bad payload' });
  }

  try {
    switch (action.type) {
      case 'proposal-done': {
        await db.run(
          `UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`,
          action.id,
        );
        return res.json({ ok: true, action: 'proposal-done', id: action.id });
      }
      case 'post-proposal-msg': {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          action.proposal_id,
          action.text,
        );
        return res.json({ ok: true, action: 'post-proposal-msg', proposal_id: action.proposal_id });
      }
      case 'create-proposal': {
        const r = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          action.feedback_id ?? null,
          action.title,
          action.summary,
          action.category ?? null,
          action.risk ?? 'medium',
          action.source ?? 'daily-run-2026-06-05',
          action.proposed_changes ? JSON.stringify(action.proposed_changes) : null,
        );
        return res.json({ ok: true, action: 'create-proposal', id: r.lastInsertRowid });
      }
      case 'post-fb-msg': {
        // Insert directly to set user_name='AI ассистент' (route doesn't allow override)
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
          action.feedback_id,
          action.text,
        );
        return res.json({ ok: true, action: 'post-fb-msg', feedback_id: action.feedback_id });
      }
      case 'update-fb': {
        const cur = await db.get('SELECT * FROM feedback WHERE id=?', action.id);
        if (!cur) return res.status(404).json({ error: 'feedback not found' });
        const newStatus = action.status ?? cur.status;
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(
          `UPDATE feedback SET
             status=?,
             admin_reply=COALESCE(?, admin_reply),
             resolved_at=${justResolved ? 'NOW()' : 'resolved_at'},
             updated_at=NOW()
           WHERE id=?`,
          newStatus,
          action.admin_reply ?? null,
          action.id,
        );
        return res.json({ ok: true, action: 'update-fb', id: action.id, status: newStatus });
      }
      default:
        return res.status(400).json({ error: `unknown action type: ${action.type}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, action });
  }
});

export default router;
