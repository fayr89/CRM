// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования (отдельным коммитом).
// Секрет одноразовый — только для этого запуска.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dR7kM2pX9vN4qJ5w';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?secret=X  → все нужные данные
// GET /api/diag/daily-run?secret=X&op=...  → выполнить операцию
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!checkSecret(req, res)) return;

    const op = req.query.op;

    // --- Операции записи ---

    if (op === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, id,
      );
      return res.json({ ok: true, id, decision });
    }

    if (op === 'create_proposal') {
      const title = req.query.title || '';
      const summary = req.query.summary || '';
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      let proposed_changes = null;
      if (req.query.changes) {
        try { proposed_changes = JSON.parse(Buffer.from(req.query.changes, 'base64').toString()); } catch {}
      }
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'post_proposal_msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    if (op === 'patch_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const admin_reply = req.query.admin_reply || null;
      if (!id) return res.status(400).json({ error: 'id required' });
      const sets = [];
      const params = [];
      if (status) { sets.push('status = ?'); params.push(status); }
      if (admin_reply !== null) { sets.push('admin_reply = ?'); params.push(admin_reply); }
      sets.push('updated_at = NOW()');
      params.push(id);
      if (sets.length > 1) {
        await db.run(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`, ...params);
      }
      return res.json({ ok: true, id });
    }

    if (op === 'post_feedback_msg') {
      const id = Number(req.query.id);
      const text = req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
         VALUES (?, 0, 'AI ассистент', 'admin', ?, NOW()) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    // --- Чтение всех данных ---

    // ai_proposals всех статусов, кроме done (не нужны)
    const proposals = await db.all(
      `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
       FROM ai_proposals p
       LEFT JOIN feedback f ON f.id = p.feedback_id
       WHERE p.status != 'done'
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC
       LIMIT 100`,
    );

    // Треды для всех proposals
    const proposalIds = proposals.map(p => p.id);
    let proposalMessages = [];
    if (proposalIds.length) {
      proposalMessages = await db.all(
        `SELECT * FROM ai_proposal_messages
         WHERE proposal_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${proposalIds.join(',')}}`,
      );
    }
    const proposalMsgMap = {};
    for (const m of proposalMessages) {
      if (!proposalMsgMap[m.proposal_id]) proposalMsgMap[m.proposal_id] = [];
      proposalMsgMap[m.proposal_id].push(m);
    }
    for (const p of proposals) p.messages = proposalMsgMap[p.id] || [];

    // feedback open/awaiting_approval
    const feedbackList = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email, u.role AS author_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );

    // Треды feedback
    const feedbackIds = feedbackList.map(f => f.id);
    let feedbackMessages = [];
    if (feedbackIds.length) {
      feedbackMessages = await db.all(
        `SELECT * FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY created_at ASC, id ASC`,
        `{${feedbackIds.join(',')}}`,
      );
    }
    const feedbackMsgMap = {};
    for (const m of feedbackMessages) {
      if (!feedbackMsgMap[m.feedback_id]) feedbackMsgMap[m.feedback_id] = [];
      feedbackMsgMap[m.feedback_id].push(m);
    }
    for (const f of feedbackList) {
      f.messages = feedbackMsgMap[f.id] || [];
      // Не отдаём тяжёлые attachments в base64
      delete f.attachments;
    }

    res.json({
      proposals,
      feedback: feedbackList,
      generated_at: new Date().toISOString(),
    });
  }),
);

export default router;
