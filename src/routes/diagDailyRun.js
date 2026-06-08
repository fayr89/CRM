// ВРЕМЕННЫЙ diag-эндпоинт для ежедневного AI-обхода обращений.
// Удалить СРАЗУ после использования отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const DIAG_SECRET = 'dlyrn20260608a9x3';

router.get('/', async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const action = req.query.action;

    // Операции записи: action=ops&ops=<base64-JSON-array>
    if (action === 'ops') {
      const opsRaw = req.query.ops;
      if (!opsRaw) return res.status(400).json({ error: 'ops required' });
      let ops;
      try {
        ops = JSON.parse(Buffer.from(opsRaw, 'base64').toString('utf8'));
      } catch (e) {
        return res.status(400).json({ error: 'invalid ops base64/json' });
      }

      const adminUser = await db.get(
        "SELECT id, name FROM users WHERE role = 'admin' AND active = true ORDER BY id LIMIT 1",
      );
      if (!adminUser) return res.status(500).json({ error: 'no admin user' });

      const results = [];
      for (const op of ops) {
        try {
          if (op.a === 'patch_proposal') {
            await db.run(
              `UPDATE ai_proposals SET status = ?, admin_notes = ?,
               admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
               WHERE id = ?`,
              op.decision, op.notes ?? null, adminUser.id, op.id,
            );
            results.push({ a: op.a, id: op.id, ok: true });

          } else if (op.a === 'post_proposal') {
            const r = await db.run(
              `INSERT INTO ai_proposals
               (feedback_id, title, summary, category, risk, source, proposed_changes)
               VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
              op.feedback_id ?? null,
              op.title,
              op.summary,
              op.category ?? null,
              op.risk || 'medium',
              op.source ?? null,
              op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
            );
            results.push({ a: op.a, id: r.lastInsertRowid, ok: true });

          } else if (op.a === 'post_proposal_msg') {
            await db.run(
              `INSERT INTO ai_proposal_messages
               (proposal_id, user_id, user_name, role, text)
               VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
              op.proposal_id, adminUser.id, op.text,
            );
            results.push({ a: op.a, proposal_id: op.proposal_id, ok: true });

          } else if (op.a === 'patch_feedback') {
            const cur = await db.get('SELECT * FROM feedback WHERE id = ?', op.id);
            if (!cur) { results.push({ a: op.a, id: op.id, ok: false, err: 'not found' }); continue; }
            const st = op.status || cur.status;
            const justResolved = (st === 'awaiting_approval' || st === 'closed')
              && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
            await db.run(
              `UPDATE feedback SET
               status = ?,
               admin_reply = COALESCE(?, admin_reply),
               resolved_by = ?,
               resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
               updated_at = NOW()
               WHERE id = ?`,
              st,
              op.admin_reply ?? null,
              justResolved ? adminUser.id : cur.resolved_by,
              op.id,
            );
            results.push({ a: op.a, id: op.id, status: st, ok: true });

          } else if (op.a === 'post_feedback_msg') {
            const fb = await db.get('SELECT id FROM feedback WHERE id = ?', op.feedback_id);
            if (!fb) { results.push({ a: op.a, feedback_id: op.feedback_id, ok: false, err: 'not found' }); continue; }
            const r = await db.run(
              `INSERT INTO feedback_messages
               (feedback_id, user_id, user_name, role, text)
               VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
              op.feedback_id, adminUser.id, op.text,
            );
            results.push({ a: op.a, feedback_id: op.feedback_id, id: r.lastInsertRowid, ok: true });

          } else {
            results.push({ a: op.a, ok: false, err: 'unknown action' });
          }
        } catch (e) {
          results.push({ a: op.a, ok: false, err: e.message });
        }
      }
      return res.json({ results });
    }

    // Чтение всех данных (нет action)
    const [proposalsApproved, proposalsRevision, proposalsRejected, proposalsPending, feedbacks] = await Promise.all([
      db.all("SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC"),
      db.all("SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC"),
      db.all("SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC"),
      db.all("SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC"),
      db.all(`
        SELECT f.*, u.name AS user_name, u.email AS user_email
        FROM feedback f LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open', 'awaiting_approval')
        ORDER BY f.created_at DESC
        LIMIT 100
      `),
    ]);

    const allProposalIds = [
      ...proposalsApproved, ...proposalsRevision, ...proposalsRejected, ...proposalsPending,
    ].map(p => p.id);

    const proposalMessages = {};
    for (const id of allProposalIds) {
      proposalMessages[id] = await db.all(
        'SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC',
        id,
      );
    }

    const feedbackMessages = {};
    for (const f of feedbacks) {
      feedbackMessages[f.id] = await db.all(
        'SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC',
        f.id,
      );
    }

    return res.json({
      proposals_approved: proposalsApproved,
      proposals_revision: proposalsRevision,
      proposals_rejected: proposalsRejected,
      proposals_pending: proposalsPending,
      feedbacks,
      proposal_messages: proposalMessages,
      feedback_messages: feedbackMessages,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
