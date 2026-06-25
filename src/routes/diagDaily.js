// TEMP — daily AI feedback run diag route. Remove after use.
// Secret: mP9wK4nR7vZx2sYq
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'mP9wK4nR7vZx2sYq';

function b64(s) {
  try { return s ? Buffer.from(s, 'base64').toString('utf8') : ''; } catch { return s || ''; }
}

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const action = req.query.action || 'read';

  try {
    // --- READ ALL ---
    if (action === 'read') {
      const feedback = await db.all(`
        SELECT f.id, f.subject, f.message, f.status, f.category, f.user_id, f.admin_reply,
               f.created_at, f.updated_at,
               u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.created_at DESC
        LIMIT 60
      `);
      for (const fb of feedback) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      const proposals = await db.all(`
        SELECT p.id, p.title, p.summary, p.category, p.risk, p.status, p.source,
               p.feedback_id, p.admin_notes, p.proposed_changes,
               p.created_at, p.updated_at
        FROM ai_proposals p
        WHERE p.status IN ('approved','revision','rejected','pending')
        ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                  WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC
        LIMIT 100
      `);
      for (const p of proposals) {
        p.thread = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      return res.json({ feedback, proposals });
    }

    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
    const adminId = adminUser?.id || null;

    // --- POST FEEDBACK MESSAGE ---
    if (action === 'post-feedback-msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = b64(req.query.text);
      const new_status = req.query.new_status || null;
      const admin_reply = req.query.admin_reply ? b64(req.query.admin_reply) : null;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        feedback_id, adminId, text,
      );
      if (new_status || admin_reply !== null) {
        const ups = ['updated_at = NOW()'];
        const ps = [];
        if (new_status) { ups.push('status = ?'); ps.push(new_status); }
        if (admin_reply !== null) { ups.push('admin_reply = ?'); ps.push(admin_reply); }
        ps.push(feedback_id);
        await db.run(`UPDATE feedback SET ${ups.join(', ')} WHERE id = ?`, ...ps);
      }
      return res.json({ ok: true });
    }

    // --- PATCH FEEDBACK STATUS ---
    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply ? b64(req.query.admin_reply) : null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const ups = ['updated_at = NOW()'];
      const ps = [];
      if (status) { ups.push('status = ?'); ps.push(status); }
      if (admin_reply !== null) { ups.push('admin_reply = ?'); ps.push(admin_reply); }
      ps.push(id);
      await db.run(`UPDATE feedback SET ${ups.join(', ')} WHERE id = ?`, ...ps);
      return res.json({ ok: true });
    }

    // --- POST AI PROPOSAL MESSAGE ---
    if (action === 'post-proposal-msg') {
      const proposal_id = Number(req.query.proposal_id);
      const text = b64(req.query.text);
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        proposal_id, adminId, text,
      );
      return res.json({ ok: true });
    }

    // --- PATCH AI PROPOSAL ---
    if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const status = req.query.status;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        status, id,
      );
      return res.json({ ok: true });
    }

    // --- CREATE AI PROPOSAL ---
    if (action === 'create-proposal') {
      const title = b64(req.query.title);
      const summary = b64(req.query.summary);
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'low';
      const source = req.query.source || 'daily-run-2026-06-25';
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.proposed_changes ? b64(req.query.proposed_changes) : '[]';
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending', NOW(), NOW())
         RETURNING id`,
        title, summary, category, risk, source, feedback_id, proposed_changes,
      );
      const newId = r.rows?.[0]?.id;
      return res.json({ ok: true, id: newId });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
