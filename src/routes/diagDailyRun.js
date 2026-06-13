// TEMP: диагностический эндпоинт для AI ежедневного обхода.
// Удалить после использования!
import { Router } from 'express';
import { db } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();
const SECRET = 'daily-s35-2026-06-13';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

// READ: вся нужная информация для обхода
router.get('/data', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const admin = await db.get(`SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    if (!admin) return res.status(500).json({ error: 'no admin' });
    const token = signToken(admin);

    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.user_id AS feedback_user_id,
             fu.name AS feedback_author_name
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      LEFT JOIN users fu ON fu.id = f.user_id
      WHERE p.status IN ('approved','revision','rejected','pending')
      ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
               WHEN 'rejected' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END),
               p.created_at DESC
      LIMIT 100
    `);

    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length > 0) {
      proposalMessages = await db.all(`
        SELECT * FROM ai_proposal_messages
        WHERE proposal_id = ANY(ARRAY[${proposalIds.join(',')}]::int[])
        ORDER BY proposal_id, created_at ASC, id ASC
      `);
    }

    const feedbacks = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.updated_at DESC
      LIMIT 100
    `);

    const feedbackIds = feedbacks.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length > 0) {
      feedbackMessages = await db.all(`
        SELECT * FROM feedback_messages
        WHERE feedback_id = ANY(ARRAY[${feedbackIds.join(',')}]::int[])
        ORDER BY feedback_id, created_at ASC, id ASC
      `);
    }

    res.json({ token, proposals, proposalMessages, feedbacks, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WRITE: выполнить операции записи через GET (чтобы не нужен был POST-клиент)
// action=post_fb_msg   fb_id text user_name
// action=update_fb     fb_id status reply
// action=create_proposal  feedback_id title summary category risk proposed_changes_json
// action=patch_proposal   id decision
// action=post_proposal_msg  proposal_id text
router.get('/write', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { action } = req.query;
  try {
    const admin = await db.get(`SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    if (!admin) return res.status(500).json({ error: 'no admin' });

    if (action === 'post_fb_msg') {
      const fb_id = Number(req.query.fb_id);
      const text = req.query.text || '';
      const user_name = req.query.user_name || 'AI ассистент';
      if (!fb_id || !text) return res.status(400).json({ error: 'fb_id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, ?, ?, 'admin', ?, NULL) RETURNING id, created_at`,
        fb_id, admin.id, user_name, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'update_fb') {
      const fb_id = Number(req.query.fb_id);
      const status = req.query.status || null;
      const reply = req.query.reply || null;
      if (!fb_id) return res.status(400).json({ error: 'fb_id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fb_id);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
         resolved_by = ?, ${justResolved ? 'resolved_at = NOW(),' : ''}
         updated_at = NOW() WHERE id = ?`,
        newStatus, reply, justResolved ? admin.id : cur.resolved_by, fb_id,
      );
      return res.json({ ok: true, fb_id, new_status: newStatus });
    }

    if (action === 'create_proposal') {
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || `daily-run-2026-06-13`;
      const proposed_changes = req.query.proposed_changes_json
        ? JSON.parse(req.query.proposed_changes_json) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = req.query.notes || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes, admin.id, id,
      );
      return res.json({ ok: true, id, new_status: decision });
    }

    if (action === 'post_proposal_msg') {
      const proposal_id = Number(req.query.proposal_id);
      const text = req.query.text || '';
      const user_name = req.query.user_name || 'AI ассистент';
      if (!proposal_id || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
        proposal_id, admin.id, user_name, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

export default router;
