// TEMP — ежедневный AI-обход 2026-06-11. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = '3k9m-dAiLy-jun11';
const router = Router();

function guard(req, res) {
  if (req.query.s !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || '';

  try {
    // --- read ai_proposals ---
    if (action === 'read_proposals') {
      const status = req.query.status;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    // --- read messages for an ai_proposal ---
    if (action === 'read_proposal_messages') {
      const id = Number(req.query.id);
      const rows = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = $1 ORDER BY created_at ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // --- patch ai_proposal status ---
    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision; // done / pending
      await db.run(
        `UPDATE ai_proposals SET status = $1, updated_at = NOW() WHERE id = $2`,
        decision,
        id,
      );
      return res.json({ ok: true });
    }

    // --- post message to ai_proposal thread ---
    if (action === 'post_proposal_message') {
      const proposalId = Number(req.query.proposal_id);
      const text = req.query.text || '';
      const userName = req.query.user_name || 'AI ассистент';
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, text, user_name, role, created_at)
         VALUES ($1, $2, $3, 'admin', NOW())`,
        proposalId,
        text,
        userName,
      );
      return res.json({ ok: true });
    }

    // --- read all feedback with threads ---
    if (action === 'read_feedback_full') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.created_at,
                f.admin_reply, f.user_id,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC`,
      );
      // attach threads
      for (const row of rows) {
        row.messages = await db.all(
          `SELECT id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = $1 ORDER BY created_at ASC`,
          row.id,
        );
      }
      return res.json({ data: rows });
    }

    // --- update feedback status/reply ---
    if (action === 'update_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply ?? null;
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = $2, updated_at = NOW() WHERE id = $3`,
        status,
        admin_reply,
        id,
      );
      return res.json({ ok: true });
    }

    // --- post message to feedback thread ---
    if (action === 'post_feedback_message') {
      const feedbackId = Number(req.query.feedback_id);
      const text = req.query.text || '';
      const userName = req.query.user_name || 'AI ассистент';
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
         VALUES ($1, $2, 'admin', $3, NOW())`,
        feedbackId,
        userName,
        text,
      );
      return res.json({ ok: true });
    }

    // --- create ai_proposal ---
    if (action === 'create_proposal') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || 'daily-run-2026-06-11';
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes
        ? JSON.parse(decodeURIComponent(req.query.proposed_changes))
        : null;
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source,
          feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', NOW(), NOW())
         RETURNING id`,
        title,
        summary,
        category,
        risk,
        source,
        feedback_id,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- manage projects: list / create / update ---
    if (action === 'list_projects') {
      const rows = await db.all(`SELECT id, name, active, is_production, sort_order FROM projects ORDER BY sort_order ASC, name ASC`);
      return res.json({ data: rows });
    }
    if (action === 'create_project') {
      const name = req.query.name || '';
      const color = req.query.color || '#6366f1';
      const is_production = req.query.is_production === 'true';
      const r = await db.run(
        `INSERT INTO projects (name, color, active, is_production, sort_order) VALUES ($1, $2, true, $3, 0) RETURNING id`,
        name, color, is_production,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'update_project') {
      const id = Number(req.query.id);
      const name = req.query.name;
      const active = req.query.active;
      const is_production = req.query.is_production;
      const sets = [];
      const params = [];
      if (name !== undefined) { sets.push(`name = $${sets.length + 1}`); params.push(name); }
      if (active !== undefined) { sets.push(`active = $${sets.length + 1}`); params.push(active === 'true'); }
      if (is_production !== undefined) { sets.push(`is_production = $${sets.length + 1}`); params.push(is_production === 'true'); }
      if (!sets.length) return res.json({ error: 'nothing to update' });
      sets.push(`updated_at = NOW()`);
      params.push(id);
      await db.run(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length}`, ...params);
      return res.json({ ok: true });
    }

    return res.json({ error: 'unknown action' });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
