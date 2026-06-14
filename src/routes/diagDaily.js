// TEMP — удалить после daily-run 2026-06-14-s60
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ds60-crm-ai-2026-0614-run';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/feedback-full?secret=X
router.get('/feedback-full', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name_join, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    for (const fb of feedbacks) {
      fb.thread = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    const closedWithPendingProposals = await db.all(
      `SELECT f.id, f.subject, f.status, f.user_id,
              u.name AS user_name, p.id AS proposal_id, p.status AS proposal_status
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       JOIN ai_proposals p ON p.feedback_id = f.id
       WHERE f.status = 'closed' AND p.status NOT IN ('done','rejected')
       ORDER BY f.created_at DESC
       LIMIT 20`,
    );

    res.json({ proposals, feedbacks, closedWithPendingProposals, generated_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/write?secret=X&data=BASE64_JSON
// Операции: post-feedback-msg, post-proposal-msg, create-proposal, update-proposal, update-feedback
router.get('/write', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const encoded = req.query.data;
    if (!encoded) return res.status(400).json({ error: 'data required' });
    const op = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));

    switch (op.op) {
      case 'post-feedback-msg': {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
           VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW())`,
          op.feedback_id, op.text,
        );
        return res.json({ ok: true });
      }
      case 'post-proposal-msg': {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text, created_at)
           VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW())`,
          op.proposal_id, op.text,
        );
        return res.json({ ok: true });
      }
      case 'create-proposal': {
        const row = await db.get(
          `INSERT INTO ai_proposals
             (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW())
           RETURNING id`,
          op.title,
          op.summary,
          op.category || 'feature',
          op.risk || 'medium',
          op.source || 'daily-run-2026-06-14-s60',
          op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
          op.feedback_id || null,
        );
        return res.json({ ok: true, id: row.id });
      }
      case 'update-proposal': {
        const sets = ['updated_at = NOW()'];
        const vals = [];
        if (op.decision) { sets.unshift('status = ?'); vals.push(op.decision); }
        if (op.notes !== undefined) { sets.unshift('admin_notes = ?'); vals.push(op.notes); }
        if (op.summary) { sets.unshift('summary = ?'); vals.push(op.summary); }
        if (op.proposed_changes) { sets.unshift('proposed_changes = ?::jsonb'); vals.push(JSON.stringify(op.proposed_changes)); }
        vals.push(op.id);
        await db.run(`UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`, ...vals);
        return res.json({ ok: true });
      }
      case 'update-feedback': {
        const sets = ['updated_at = NOW()'];
        const vals = [];
        if (op.status) { sets.unshift('status = ?'); vals.push(op.status); }
        if (op.admin_reply !== undefined) { sets.unshift('admin_reply = ?'); vals.push(op.admin_reply); }
        vals.push(op.id);
        await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...vals);
        return res.json({ ok: true });
      }
      default:
        return res.status(400).json({ error: `unknown op: ${op.op}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
