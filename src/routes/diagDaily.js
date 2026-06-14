// TEMP — удалить после daily-run 2026-06-14-s58
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ds58-crm-ai-2026-0614-run';

function guard(req, res) {
  if (req.query.secret !== SECRET && req.body?.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/feedback-full — все данные для обхода
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

    const closedWithProposals = await db.all(
      `SELECT f.id, f.subject, f.status, f.user_id,
              u.name AS user_name, p.id AS proposal_id, p.status AS proposal_status
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       JOIN ai_proposals p ON p.feedback_id = f.id
       WHERE f.status = 'closed' AND p.status NOT IN ('done')
       ORDER BY f.created_at DESC
       LIMIT 20`,
    );

    res.json({ proposals, feedbacks, closedWithProposals, generated_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/feedback-message — написать в тред обращения
router.post('/feedback-message', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { feedback_id, text } = req.body;
    if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW())`,
      feedback_id, text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/proposal-message — написать в тред ai_proposal
router.post('/proposal-message', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { proposal_id, text } = req.body;
    if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text, created_at)
       VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW())`,
      proposal_id, text,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/create-proposal — создать ai_proposal
router.post('/create-proposal', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { title, summary, category, risk, source, proposed_changes, feedback_id } = req.body;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    const row = await db.get(
      `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())
       RETURNING id`,
      title,
      summary,
      category || 'feature',
      risk || 'medium',
      source || 'daily-run-2026-06-14-s58',
      proposed_changes ? JSON.stringify(proposed_changes) : null,
      feedback_id || null,
    );
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/update-proposal — обновить статус/summary proposal
router.post('/update-proposal', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { id, decision, summary, proposed_changes } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const updates = [];
    const vals = [];
    if (decision) { updates.push('status = ?'); vals.push(decision); }
    if (summary) { updates.push('summary = ?'); vals.push(summary); }
    if (proposed_changes) { updates.push('proposed_changes = ?'); vals.push(JSON.stringify(proposed_changes)); }
    updates.push('updated_at = NOW()');
    vals.push(id);
    await db.run(`UPDATE ai_proposals SET ${updates.join(', ')} WHERE id = ?`, ...vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/update-feedback — обновить статус обращения
router.post('/update-feedback', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { id, status, admin_reply } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    const updates = ['status = ?', 'updated_at = NOW()'];
    const vals = [status];
    if (admin_reply !== undefined) { updates.push('admin_reply = ?'); vals.push(admin_reply); }
    vals.push(id);
    await db.run(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`, ...vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
