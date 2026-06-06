// TEMP — диаг-роут для ежедневного AI-обхода. Снести сразу после использования.
// Секрет: q8Xz2kL9mN4vR7wP (одноразовый, только для этой сессии).
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'q8Xz2kL9mN4vR7wP';

function checkSecret(req, res, next) {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.use(checkSecret);

// GET /api/diag/daily-full — всё что нужно для ежедневного обхода
router.get('/daily-full', async (req, res) => {
  try {
    const [approvedProposals, revisionProposals, rejectedProposals, pendingProposals] =
      await Promise.all([
        db.all(`SELECT p.*, u.name AS admin_decision_by_name, f.subject AS feedback_subject
                FROM ai_proposals p
                LEFT JOIN users u ON u.id = p.admin_decision_by
                LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'approved' ORDER BY p.created_at DESC`),
        db.all(`SELECT p.*, u.name AS admin_decision_by_name, f.subject AS feedback_subject
                FROM ai_proposals p
                LEFT JOIN users u ON u.id = p.admin_decision_by
                LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'revision' ORDER BY p.created_at DESC`),
        db.all(`SELECT p.*, u.name AS admin_decision_by_name, f.subject AS feedback_subject
                FROM ai_proposals p
                LEFT JOIN users u ON u.id = p.admin_decision_by
                LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'rejected' ORDER BY p.created_at DESC`),
        db.all(`SELECT p.*, u.name AS admin_decision_by_name, f.subject AS feedback_subject
                FROM ai_proposals p
                LEFT JOIN users u ON u.id = p.admin_decision_by
                LEFT JOIN feedback f ON f.id = p.feedback_id
                WHERE p.status = 'pending' ORDER BY p.created_at DESC`),
      ]);

    // Треды для approved/revision/pending
    const proposalsNeedingThreads = [
      ...approvedProposals, ...revisionProposals, ...pendingProposals,
    ];
    const proposalThreads = {};
    await Promise.all(proposalsNeedingThreads.map(async (p) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      proposalThreads[p.id] = msgs;
    }));

    // Feedback: open + awaiting_approval с тредами
    const feedbackList = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.updated_at DESC NULLS LAST, f.created_at DESC`,
    );

    const feedbackThreads = {};
    await Promise.all(feedbackList.map(async (f) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        f.id,
      );
      feedbackThreads[f.id] = msgs;
    }));

    res.json({
      proposals: { approved: approvedProposals, revision: revisionProposals, rejected: rejectedProposals, pending: pendingProposals },
      proposalThreads,
      feedback: feedbackList,
      feedbackThreads,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/action — выполнить действие от имени AI
// body: { type, ...params }
// types: proposal_done, proposal_create, proposal_message, feedback_update, feedback_message
router.post('/action', async (req, res) => {
  const { type, ...params } = req.body || {};
  try {
    // Найти id администратора для операций требующих user_id
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || 1;

    if (type === 'proposal_done') {
      // Отметить предложение выполненным
      await db.run(
        `UPDATE ai_proposals SET status='done', admin_decision_by=?, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
        adminId, params.id,
      );
      return res.json({ ok: true });
    }

    if (type === 'proposal_create') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        params.feedback_id ?? null,
        params.title,
        params.summary,
        params.category ?? null,
        params.risk || 'medium',
        params.source ?? null,
        params.proposed_changes ? JSON.stringify(params.proposed_changes) : null,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    if (type === 'proposal_message') {
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        params.proposal_id, adminId, params.text,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    if (type === 'feedback_update') {
      // status, admin_reply
      const sets = [];
      const vals = [];
      if (params.status) { sets.push('status=?'); vals.push(params.status); }
      if (params.admin_reply !== undefined) { sets.push('admin_reply=?'); vals.push(params.admin_reply); }
      sets.push('updated_at=NOW()');
      await db.run(
        `UPDATE feedback SET ${sets.join(', ')} WHERE id=?`,
        ...vals, params.id,
      );
      return res.json({ ok: true });
    }

    if (type === 'feedback_message') {
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id, created_at`,
        params.feedback_id, adminId, params.text,
      );
      return res.json({ id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown type' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
