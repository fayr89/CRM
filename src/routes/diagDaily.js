// TEMP — ежедневный диаг-обход AI (2026-06-10). Снести сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'ai-daily-10jun2026-x7k9';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// GET — все данные для обхода: ai_proposals по статусам + их треды + open feedback + треды
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
      // decision: 'done' | 'pending' | ...
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
        body.source || 'daily-run-2026-06-10',
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
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = ?, updated_at = NOW() WHERE id = ?`,
        body.status, body.admin_reply || null, Number(body.id)
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
