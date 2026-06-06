// TEMP: ежедневный AI-обход 2026-06-06-v63. Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'ai-daily-ms20c-v63-x7kqp';
const router = Router();

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  const action = req.query.action || 'data';
  try {
    if (action === 'data') {
      const proposals = await db.all(`
        SELECT p.*, u.name AS admin_decision_by_name,
               f.subject AS feedback_subject, f.user_id AS feedback_user_id
        FROM ai_proposals p
        LEFT JOIN users u ON u.id = p.admin_decision_by
        LEFT JOIN feedback f ON f.id = p.feedback_id
        ORDER BY p.created_at DESC LIMIT 100`);
      for (const p of proposals) {
        p.messages = await db.all(
          'SELECT * FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC', p.id);
      }
      const feedbacks = await db.all(`
        SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','awaiting_approval')
        ORDER BY f.created_at ASC`);
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          'SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC', fb.id);
      }
      res.json({ proposals, feedbacks });

    } else if (action === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id+decision required' });
      const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
      await db.run(
        `UPDATE ai_proposals SET status=?, admin_notes=COALESCE(?,admin_notes),
         admin_decision_by=?, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
        decision, req.query.notes ?? null, admin?.id, id);
      res.json({ ok: true, id });

    } else if (action === 'post-proposal') {
      const { title, summary, category, risk, source, feedback_id } = req.query;
      if (!title || !summary) return res.status(400).json({ error: 'title+summary required' });
      let pc = null;
      try { pc = req.query.proposed_changes ? JSON.parse(req.query.proposed_changes) : null; } catch (_) {}
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
         VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary, category || 'feature', risk || 'medium',
        source || `daily-run-${new Date().toISOString().slice(0, 10)}`,
        pc ? JSON.stringify(pc) : null);
      res.json({ ok: true, id: r.lastInsertRowid });

    } else if (action === 'post-proposal-msg') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id+text required' });
      const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id,user_id,user_name,role,text)
         VALUES (?,?,?,?,?)`,
        id, admin?.id, 'AI ассистент', 'admin', text);
      res.json({ ok: true });

    } else if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      if (!id || !status) return res.status(400).json({ error: 'id+status required' });
      const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
      const needResolve = ['awaiting_approval', 'closed'].includes(status);
      await db.run(
        `UPDATE feedback SET status=?,
         admin_reply=COALESCE(?,admin_reply),
         resolved_by=CASE WHEN ? THEN ? ELSE resolved_by END,
         resolved_at=CASE WHEN ? THEN NOW() ELSE resolved_at END,
         updated_at=NOW() WHERE id=?`,
        status, req.query.admin_reply ?? null,
        needResolve, admin?.id,
        needResolve,
        id);
      res.json({ ok: true });

    } else if (action === 'post-feedback-msg') {
      const id = Number(req.query.id);
      const text = req.query.text;
      const user_name = req.query.user_name || 'AI ассистент';
      if (!id || !text) return res.status(400).json({ error: 'id+text required' });
      const admin = await db.get("SELECT id FROM users WHERE role='admin' LIMIT 1");
      await db.run(
        `INSERT INTO feedback_messages (feedback_id,user_id,user_name,role,text)
         VALUES (?,?,?,?,?)`,
        id, admin?.id, user_name, 'admin', text);
      res.json({ ok: true });

    } else {
      res.status(400).json({ error: 'unknown action' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
