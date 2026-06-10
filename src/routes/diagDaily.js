// TEMP — ежедневный диаг-обход AI (2026-06-10-v2). Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-daily-10jun2026-v2-p4n7';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET write actions via query params (для Vercel MCP который поддерживает только GET)
router.get('/write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { action } = req.query;
  try {
    if (action === 'post_feedback_message') {
      const fbId = Number(req.query.feedback_id);
      const text = req.query.text || '';
      if (!fbId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
         VALUES (?, 'AI ассистент', 'admin', ?, NOW())`,
        fbId, text,
      );
      await db.run(`UPDATE feedback SET updated_at = NOW() WHERE id = ?`, fbId);
      return res.json({ ok: true });
    }
    if (action === 'patch_feedback') {
      const fbId = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = req.query.admin_reply || null;
      if (!fbId || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply, fbId,
      );
      return res.json({ ok: true });
    }
    if (action === 'post_proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
        req.query.title || '',
        req.query.summary || '',
        req.query.category || 'feature',
        req.query.risk || 'medium',
        'daily-run-2026-06-10-v2',
        req.query.proposed_changes ? JSON.stringify(JSON.parse(req.query.proposed_changes)) : null,
        req.query.feedback_id ? Number(req.query.feedback_id) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'patch_proposal') {
      const pid = Number(req.query.id);
      const decision = req.query.decision;
      if (!pid || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, decision, pid);
      return res.json({ ok: true });
    }
    if (action === 'post_proposal_message') {
      const pid = Number(req.query.proposal_id);
      const text = req.query.text || '';
      if (!pid || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at) VALUES (?, 'AI ассистент', ?, NOW())`,
        pid, text,
      );
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET — все данные для обхода: ai_proposals по статусам + треды + open feedback + треды
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const approved = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status='approved' ORDER BY p.updated_at DESC`
    );
    const revision = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status='revision' ORDER BY p.updated_at DESC`
    );
    const rejected = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status='rejected' ORDER BY p.updated_at DESC LIMIT 20`
    );
    const pending = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.admin_decision_by WHERE p.status='pending' ORDER BY p.updated_at DESC`
    );

    const allIds = [...approved, ...revision, ...rejected, ...pending].map(p => p.id);
    let proposalMessages = [];
    if (allIds.length > 0) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY($1::int[]) ORDER BY created_at ASC`,
        allIds
      );
    }

    const feedback = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY f.updated_at DESC`
    );
    const fbIds = feedback.map(f => f.id);
    let feedbackMessages = [];
    if (fbIds.length > 0) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages WHERE feedback_id = ANY($1::int[]) ORDER BY created_at ASC`,
        fbIds
      );
    }

    res.json({ approved, revision, rejected, pending, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST — запись: одно действие за вызов
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { action, ...body } = req.body || {};
  try {
    if (action === 'patch_proposal') {
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        body.decision, Number(body.id)
      );
      return res.json({ ok: true });
    }
    if (action === 'post_proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (title, summary, category, risk, source, proposed_changes, feedback_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', NOW(), NOW()) RETURNING id`,
        body.title,
        body.summary,
        body.category || 'feature',
        body.risk || 'medium',
        body.source || 'daily-run-2026-06-10-v2',
        body.proposed_changes ? JSON.stringify(body.proposed_changes) : null,
        body.feedback_id || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }
    if (action === 'post_proposal_message') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, text, created_at) VALUES (?, 'AI ассистент', ?, NOW())`,
        Number(body.proposal_id), body.text,
      );
      return res.json({ ok: true });
    }
    if (action === 'patch_feedback') {
      const fields = [];
      const vals = [];
      if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }
      if (body.admin_reply !== undefined) { fields.push('admin_reply = ?'); vals.push(body.admin_reply); }
      fields.push('updated_at = NOW()');
      vals.push(Number(body.id));
      await db.run(
        `UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`,
        ...vals
      );
      return res.json({ ok: true });
    }
    if (action === 'post_feedback_message') {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_name, role, text, created_at)
         VALUES (?, ?, 'admin', ?, NOW())`,
        Number(body.feedback_id), body.user_name || 'AI ассистент', body.text,
      );
      await db.run(`UPDATE feedback SET updated_at = NOW() WHERE id = ?`, Number(body.feedback_id));
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: `unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
