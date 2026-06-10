// TEMP: ежедневный AI-обход обращений 2026-06-10-v15. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const S = 'daily-v15-9x2p4k71';

function guard(req, res) {
  if (req.query.s !== S) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /api/diag/ai-daily/read?s=... — все данные для обхода
router.get('/read', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      proposals[status] = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id, fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC LIMIT 50`,
        status,
      );
    }

    const allIds = Object.values(proposals).flat().map((p) => p.id);
    const proposalMessages = {};
    for (const id of allIds) {
      proposalMessages[id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
    }

    const feedback = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval')
       ORDER BY (CASE f.status WHEN 'open' THEN 0 ELSE 1 END), f.updated_at DESC
       LIMIT 100`,
    );
    const feedbackMessages = {};
    for (const fb of feedback) {
      feedbackMessages[fb.id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    res.json({ ok: true, proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/diag/ai-daily/write?s=...&op=...
router.get('/write', async (req, res) => {
  if (!guard(req, res)) return;
  const { op } = req.query;
  const p = (k) => req.query[k];
  try {
    if (op === 'patch-proposal') {
      const id = Number(p('id'));
      const decision = p('decision');
      if (!id || !decision) return res.json({ ok: false, error: 'id and decision required' });
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, decision, id);
      return res.json({ ok: true, data: await db.get('SELECT id, status, title FROM ai_proposals WHERE id = ?', id) });
    }

    if (op === 'post-proposal') {
      const title = p('title');
      const summary = p('summary');
      const category = p('category') || null;
      const risk = p('risk') || 'medium';
      const source = p('source') || null;
      const feedback_id = p('feedback_id') ? Number(p('feedback_id')) : null;
      const proposed_changes = p('proposed_changes') || null;
      if (!title || !summary) return res.json({ ok: false, error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source, proposed_changes,
      );
      return res.json({ ok: true, data: await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid) });
    }

    if (op === 'post-feedback-msg') {
      const feedback_id = Number(p('feedback_id'));
      const text = p('text');
      if (!feedback_id || !text) return res.json({ ok: false, error: 'feedback_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, user_name, text, created_at FROM feedback_messages WHERE id = ?', r.lastInsertRowid) });
    }

    if (op === 'patch-feedback') {
      const id = Number(p('id'));
      const status = p('status');
      const admin_reply = p('admin_reply') || null;
      if (!id) return res.json({ ok: false, error: 'id required' });
      await db.run(
        `UPDATE feedback SET status = COALESCE(?, status), admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, admin_reply, id,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, status, admin_reply, subject FROM feedback WHERE id = ?', id) });
    }

    if (op === 'post-proposal-msg') {
      const proposal_id = Number(p('proposal_id'));
      const text = p('text');
      if (!proposal_id || !text) return res.json({ ok: false, error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_name, role, text)
         VALUES (?, 'AI ассистент', 'admin', ?) RETURNING id`,
        proposal_id, text,
      );
      return res.json({ ok: true, data: await db.get('SELECT id, user_name, text, created_at FROM ai_proposal_messages WHERE id = ?', r.lastInsertRowid) });
    }

    res.json({ ok: false, error: 'unknown op', ops: ['patch-proposal', 'post-proposal', 'post-feedback-msg', 'patch-feedback', 'post-proposal-msg'] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
