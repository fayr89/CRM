// TEMP: ежедневный AI-обход обращений 2026-06-10-v12. Снести после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const S = 'daily-v12-04674c41';

function ok(req, res) {
  if (req.query.s !== S) { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

// GET /api/diag/ai-daily/read?s=... — все данные для обхода
router.get('/read', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const proposals = {};
    for (const status of ['approved', 'revision', 'rejected', 'pending']) {
      const rows = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.status AS feedback_status,
                f.user_id AS feedback_user_id, fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         WHERE p.status = ?
         ORDER BY p.created_at DESC LIMIT 50`,
        status,
      );
      proposals[status] = rows;
    }

    // треды для каждого proposal
    const allProposalIds = [
      ...proposals.approved, ...proposals.revision,
      ...proposals.rejected, ...proposals.pending,
    ].map((p) => p.id);
    const proposalMessages = {};
    for (const id of allProposalIds) {
      proposalMessages[id] = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
    }

    // feedback: open и awaiting_approval с тредами
    const feedback = await db.all(
      `SELECT f.*, u.name AS author_name, u.email AS author_email, u.role AS author_role
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

    // первый admin
    const adminUser = await db.get(
      `SELECT id, name FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`,
    );

    res.json({ proposals, proposalMessages, feedback, feedbackMessages, adminUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/ai-daily/write?s=...&actions=BASE64JSON
// actions = base64(JSON array of action objects)
// Поддерживаемые типы:
//   { type:'patch_proposal', id, status }
//   { type:'create_proposal', title, summary, category, risk, source, proposed_changes, feedback_id }
//   { type:'post_proposal_msg', proposal_id, text }
//   { type:'patch_feedback', id, status, admin_reply }
//   { type:'post_feedback_msg', feedback_id, text }
router.get('/write', async (req, res) => {
  if (!ok(req, res)) return;
  let actions;
  try {
    actions = JSON.parse(Buffer.from(req.query.actions || '', 'base64url').toString('utf8'));
  } catch {
    try {
      actions = JSON.parse(Buffer.from(req.query.actions || '', 'base64').toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid actions param' });
    }
  }
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions must be array' });

  const adminUser = await db.get(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`,
  ).catch(() => null);
  const adminId = adminUser?.id || null;

  const results = [];
  for (const act of actions) {
    try {
      if (act.type === 'patch_proposal') {
        await db.run(
          `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
          act.status, act.id,
        );
        results.push({ type: act.type, ok: true, id: act.id });

      } else if (act.type === 'create_proposal') {
        const ins = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          act.feedback_id ?? null, act.title, act.summary,
          act.category ?? null, act.risk ?? 'medium',
          act.source ?? 'daily-run-2026-06-10',
          act.proposed_changes ? JSON.stringify(act.proposed_changes) : null,
        );
        results.push({ type: act.type, ok: true, id: ins.lastInsertRowid });

      } else if (act.type === 'post_proposal_msg') {
        const ins = await db.get(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
          act.proposal_id, adminId, act.text,
        );
        results.push({ type: act.type, ok: true, id: ins?.id });

      } else if (act.type === 'patch_feedback') {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', act.id);
        if (!cur) { results.push({ type: act.type, ok: false, error: 'not found', id: act.id }); continue; }
        const newStatus = act.status ?? cur.status;
        const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
          && !['awaiting_approval', 'closed'].includes(cur.status);
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = ${justResolved ? '?' : 'resolved_by'},
             resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
             updated_at = NOW()
           WHERE id = ?`,
          ...(justResolved
            ? [newStatus, act.admin_reply ?? null, adminId, act.id]
            : [newStatus, act.admin_reply ?? null, act.id]),
        );
        results.push({ type: act.type, ok: true, id: act.id, new_status: newStatus });

      } else if (act.type === 'post_feedback_msg') {
        const ins = await db.get(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
          act.feedback_id, adminId, act.text,
        );
        results.push({ type: act.type, ok: true, id: ins?.id });

      } else {
        results.push({ type: act.type, ok: false, error: `unknown type: ${act.type}` });
      }
    } catch (e) {
      results.push({ type: act.type, ok: false, error: e.message, act });
    }
  }
  res.json({ results });
});

export default router;
