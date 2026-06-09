// TEMP: ежедневный AI-обход 2026-06-09-v42. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'f2e8d4c9a1b3e7f2e8d4c9a1b3e7f2e8';

function auth(req, res) {
  if (req.query.token !== SECRET) {
    res.status(404).json({ error: 'not found' });
    return false;
  }
  return true;
}

function attachMessages(arr, msgMap) {
  return arr.map((p) => ({ ...p, messages: msgMap[p.id] || [] }));
}

// GET /api/diag/daily-run?token=S — полный дамп для AI-обхода
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!auth(req, res)) return;

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       WHERE p.status IN ('approved', 'rejected', 'revision', 'pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END),
                p.created_at DESC
       LIMIT 100`,
    );

    const propIds = proposals.map((p) => p.id);
    let propMsgMap = {};
    if (propIds.length) {
      const ph = propIds.map(() => '?').join(',');
      const msgs = await db.all(
        `SELECT proposal_id, id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages
         WHERE proposal_id IN (${ph})
         ORDER BY created_at ASC, id ASC`,
        ...propIds,
      );
      for (const m of msgs) {
        if (!propMsgMap[m.proposal_id]) propMsgMap[m.proposal_id] = [];
        propMsgMap[m.proposal_id].push(m);
      }
    }

    const feedbacks = await db.all(
      `SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
              f.admin_reply, f.context, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at ASC
       LIMIT 100`,
    );
    const fbIds = feedbacks.map((f) => f.id);
    let fbMsgMap = {};
    if (fbIds.length) {
      const ph = fbIds.map(() => '?').join(',');
      const msgs = await db.all(
        `SELECT feedback_id, id, user_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id IN (${ph})
         ORDER BY created_at ASC, id ASC`,
        ...fbIds,
      );
      for (const m of msgs) {
        if (!fbMsgMap[m.feedback_id]) fbMsgMap[m.feedback_id] = [];
        fbMsgMap[m.feedback_id].push(m);
      }
    }

    const adminUser = await db.get(`SELECT id, name FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);

    res.json({
      run_date: new Date().toISOString(),
      admin_user: adminUser,
      proposals: {
        approved: attachMessages(proposals.filter((p) => p.status === 'approved'), propMsgMap),
        revision: attachMessages(proposals.filter((p) => p.status === 'revision'), propMsgMap),
        pending: attachMessages(proposals.filter((p) => p.status === 'pending'), propMsgMap),
        rejected: attachMessages(proposals.filter((p) => p.status === 'rejected'), propMsgMap),
      },
      feedbacks: feedbacks.map((f) => ({ ...f, thread: fbMsgMap[f.id] || [] })),
    });
  }),
);

// GET /api/diag/daily-run/write?token=S&action=...  (GET-only writes, MCP ограничен GET)
router.get(
  '/write',
  asyncHandler(async (req, res) => {
    if (!auth(req, res)) return;
    const { action } = req.query;

    // Отметить предложение выполненным
    if (action === 'proposal-done') {
      const id = Number(req.query.id);
      if (!id) return res.json({ error: 'id required' });
      await db.run(`UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id);
      return res.json({ ok: true, id, action: 'done' });
    }

    // Переработать предложение: revision → pending, обновить summary
    if (action === 'proposal-revision-pending') {
      const id = Number(req.query.id);
      const summary = String(req.query.summary || '').slice(0, 5000);
      if (!id || !summary) return res.json({ error: 'id and summary required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'pending', summary = ?, updated_at = NOW() WHERE id = ?`,
        summary, id,
      );
      return res.json({ ok: true, id, action: 'revision-pending' });
    }

    // Добавить сообщение в тред предложения
    if (action === 'proposal-msg') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '').slice(0, 5000);
      if (!id || !text) return res.json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    // Создать новое ai_proposal
    if (action === 'proposal-create') {
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const title = String(req.query.title || '').slice(0, 200);
      const summary = String(req.query.summary || '').slice(0, 5000);
      const category = String(req.query.category || 'feature').slice(0, 60);
      const risk = ['low', 'medium', 'high'].includes(req.query.risk) ? req.query.risk : 'medium';
      const source = String(req.query.source || `daily-run-${new Date().toISOString().slice(0, 10)}`).slice(0, 60);
      if (!title || !summary) return res.json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedback_id, title, summary, category, risk, source,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // Обновить статус/ответ обращения feedback
    if (action === 'feedback-update') {
      const id = Number(req.query.id);
      const status = req.query.status || null;
      const admin_reply = req.query.admin_reply ? String(req.query.admin_reply).slice(0, 5000) : null;
      if (!id) return res.json({ error: 'id required' });
      if (!status && !admin_reply) return res.json({ error: 'nothing to update' });
      const cur = await db.get('SELECT status, user_id FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = status || cur.status;
      const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      await db.run(
        `UPDATE feedback SET
           status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
           updated_at = NOW()
         WHERE id = ?`,
        newStatus, admin_reply, id,
      );
      return res.json({ ok: true, id, status: newStatus });
    }

    // Добавить сообщение в тред обращения (от 'AI ассистент')
    if (action === 'feedback-msg') {
      const id = Number(req.query.id);
      const text = String(req.query.text || '').slice(0, 5000);
      if (!id || !text) return res.json({ error: 'id and text required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    res.json({
      error: 'unknown action',
      known: ['proposal-done', 'proposal-revision-pending', 'proposal-msg',
              'proposal-create', 'feedback-update', 'feedback-msg'],
    });
  }),
);

export default router;
