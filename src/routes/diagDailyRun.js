// TEMPORARY: ежедневный AI-обход 2026-06-23. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'run-2026-06-23-q8w3n5vx';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// READ-ALL: все proposals + feedback с тредами
router.get('/read-all', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  const proposals = await db.all(
    `SELECT p.*, u.name AS admin_decision_by_name,
            f.subject AS feedback_subject, f.user_id AS feedback_user_id,
            fu.name AS feedback_author_name
     FROM ai_proposals p
     LEFT JOIN users u ON u.id = p.admin_decision_by
     LEFT JOIN feedback f ON f.id = p.feedback_id
     LEFT JOIN users fu ON fu.id = f.user_id
     ORDER BY p.id ASC`,
  );

  const proposalMessages = {};
  for (const p of proposals) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
      p.id,
    );
    proposalMessages[p.id] = msgs;
  }

  const feedbackRows = await db.all(
    `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.status IN ('open','awaiting_approval','in_progress')
     ORDER BY f.created_at DESC`,
  );

  const feedbackMessages = {};
  for (const fb of feedbackRows) {
    const msgs = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
      fb.id,
    );
    feedbackMessages[fb.id] = msgs;
  }

  res.json({ proposals, proposalMessages, feedbackRows, feedbackMessages });
}));

// WRITE: пакетное выполнение операций
// data = base64-encoded JSON array of operations
router.get('/write', asyncHandler(async (req, res) => {
  if (!checkSecret(req, res)) return;

  let ops;
  try {
    ops = JSON.parse(Buffer.from(req.query.data, 'base64').toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'bad data encoding' });
  }

  const results = [];
  for (const op of ops) {
    try {
      if (op.type === 'patch-proposal') {
        await db.run(
          `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
          op.decision, op.id,
        );
        results.push({ op: op.type, id: op.id, ok: true });

      } else if (op.type === 'post-proposal-message') {
        const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
        const r = await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
           VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
          op.id, adminUser?.id || null, 'AI ассистент', op.text,
        );
        results.push({ op: op.type, id: op.id, msg_id: r.lastInsertRowid, ok: true });

      } else if (op.type === 'create-proposal') {
        const r = await db.run(
          `INSERT INTO ai_proposals
           (feedback_id, title, summary, category, risk, source, proposed_changes)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
          op.feedback_id ?? null, op.title, op.summary,
          op.category ?? 'feature', op.risk ?? 'medium', op.source ?? null,
          op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
        );
        results.push({ op: op.type, new_id: r.lastInsertRowid, ok: true });

      } else if (op.type === 'patch-feedback') {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', op.id);
        if (!cur) { results.push({ op: op.type, id: op.id, ok: false, err: 'not found' }); continue; }
        const newStatus = op.status ?? cur.status;
        const justResolved = (newStatus === 'awaiting_approval' || newStatus === 'closed')
          && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
             resolved_at = CASE WHEN ? THEN NOW() ELSE resolved_at END,
             updated_at = NOW()
           WHERE id = ?`,
          newStatus, op.admin_reply ?? null,
          justResolved, adminUser?.id || null,
          justResolved,
          op.id,
        );
        results.push({ op: op.type, id: op.id, ok: true });

      } else if (op.type === 'post-feedback-message') {
        const fb = await db.get('SELECT id FROM feedback WHERE id = ?', op.feedback_id);
        if (!fb) { results.push({ op: op.type, feedback_id: op.feedback_id, ok: false, err: 'not found' }); continue; }
        const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1`);
        const r = await db.run(
          `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
           VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
          op.feedback_id, adminUser?.id || null, op.text,
        );
        results.push({ op: op.type, feedback_id: op.feedback_id, msg_id: r.lastInsertRowid, ok: true });

      } else {
        results.push({ op: op.type, ok: false, err: 'unknown op type' });
      }
    } catch (e) {
      results.push({ op: op?.type, id: op?.id, ok: false, err: e.message });
    }
  }

  res.json({ results });
}));

export default router;
