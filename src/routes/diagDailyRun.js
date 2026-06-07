// ВРЕМЕННЫЙ диагностический эндпоинт для AI-ежедневного обхода.
// Удалить сразу после использования!
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-07-v11';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// READ: все данные для обхода
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const byStatus = async (status) => db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status = $1 ORDER BY p.created_at DESC`,
      [status],
    );
    const proposals_approved = await byStatus('approved');
    const proposals_revision = await byStatus('revision');
    const proposals_rejected = await byStatus('rejected');
    const proposals_pending  = await byStatus('pending');

    const allIds = [...proposals_approved, ...proposals_revision, ...proposals_rejected, ...proposals_pending].map(p => p.id);
    const proposal_messages = allIds.length
      ? await db.all(`SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY($1::int[]) ORDER BY proposal_id, created_at ASC`, [allIds])
      : [];

    const feedback = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC`,
    );
    const fbIds = feedback.map(f => f.id);
    const feedback_messages = fbIds.length
      ? await db.all(`SELECT * FROM feedback_messages WHERE feedback_id = ANY($1::int[]) ORDER BY feedback_id, created_at ASC`, [fbIds])
      : [];

    res.json({ proposals_approved, proposals_revision, proposals_rejected, proposals_pending, proposal_messages, feedback, feedback_messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// WRITE actions via GET (web_fetch_vercel_url supports GET only)
router.get('/action', async (req, res) => {
  if (!guard(req, res)) return;
  const { action } = req.query;
  try {
    if (action === 'mark_proposal_done') {
      const { proposal_id } = req.query;
      await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=$1`, [proposal_id]);
      return res.json({ ok: true, action, proposal_id });
    }
    if (action === 'post_proposal_msg') {
      const { proposal_id, text } = req.query;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text, created_at) VALUES ($1,$2,'admin',$3,NOW())`,
        [proposal_id, 'AI ассистент', text],
      );
      return res.json({ ok: true, action, proposal_id });
    }
    if (action === 'create_proposal') {
      const { title, summary, category, risk, source, feedback_id, proposed_changes } = req.query;
      const row = await db.get(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW(),NOW()) RETURNING id`,
        [title, summary, category || 'feature', risk || 'medium', source || 'daily-run-2026-06-07', feedback_id || null, proposed_changes || '[]'],
      );
      return res.json({ ok: true, action, id: row.id });
    }
    if (action === 'update_proposal') {
      const { proposal_id, summary, proposed_changes, status } = req.query;
      const updates = [];
      const vals = [];
      let i = 1;
      if (summary) { updates.push(`summary=$${i++}`); vals.push(summary); }
      if (proposed_changes) { updates.push(`proposed_changes=$${i++}`); vals.push(proposed_changes); }
      if (status) { updates.push(`status=$${i++}`); vals.push(status); }
      updates.push(`updated_at=NOW()`);
      vals.push(proposal_id);
      await db.run(`UPDATE ai_proposals SET ${updates.join(',')} WHERE id=$${i}`, vals);
      return res.json({ ok: true, action, proposal_id });
    }
    if (action === 'post_feedback_msg') {
      const { feedback_id, text } = req.query;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at) VALUES ($1,$2,'admin',$3,NOW())`,
        [feedback_id, 'AI ассистент', text],
      );
      return res.json({ ok: true, action, feedback_id });
    }
    if (action === 'update_feedback') {
      const { feedback_id, status, admin_reply } = req.query;
      const updates = ['updated_at=NOW()'];
      const vals = [];
      let i = 1;
      if (status) { updates.push(`status=$${i++}`); vals.push(status); }
      if (admin_reply !== undefined) { updates.push(`admin_reply=$${i++}`); vals.push(admin_reply); }
      vals.push(feedback_id);
      await db.run(`UPDATE feedback SET ${updates.join(',')} WHERE id=$${i}`, vals);
      return res.json({ ok: true, action, feedback_id });
    }
    res.status(400).json({ error: 'unknown action', action });
  } catch (err) { res.status(500).json({ error: err.message, action }); }
});

export default router;
