// TEMP diag daily-run 2026-06-12-s15 — DELETE after run
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dd-s15-2026-06-12-Rm8vLz3wPq';

function auth(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

async function adminId() {
  const r = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
  return r?.id ?? null;
}

router.get('/', async (req, res) => {
  if (!auth(req, res)) return;
  const action = req.query.action;
  if (action) return handleAction(req, res);

  try {
    const approved = await db.all(`SELECT * FROM ai_proposals WHERE status='approved' ORDER BY id`);
    const revision = await db.all(`SELECT * FROM ai_proposals WHERE status='revision' ORDER BY id`);
    const rejected = await db.all(
      `SELECT * FROM ai_proposals WHERE status='rejected' AND feedback_id IS NOT NULL ORDER BY id`,
    );
    const pending = await db.all(`SELECT * FROM ai_proposals WHERE status='pending' ORDER BY id`);

    const propMsgs = {};
    for (const p of [...approved, ...revision, ...pending]) {
      propMsgs[p.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id=? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.created_at DESC
    `);

    const fbMsgs = {};
    for (const fb of feedback) {
      fbMsgs[fb.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id=? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    res.json({ approved, revision, rejected, pending, propMsgs, feedback, fbMsgs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function handleAction(req, res) {
  try {
    const { action } = req.query;
    const aid = await adminId();

    if (action === 'patch-proposal') {
      const { id, decision, notes } = req.query;
      await db.run(
        `UPDATE ai_proposals SET status=?, admin_notes=?, admin_decision_by=?,
         admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
        decision, notes ?? null, aid, Number(id),
      );
      return res.json({ ok: true, id, decision });
    }

    if (action === 'proposal-msg') {
      const { id, text } = req.query;
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?)`,
        Number(id), aid, 'AI ассистент', 'admin', text,
      );
      return res.status(201).json({ ok: true });
    }

    if (action === 'create-proposal') {
      const { feedback_id, title, summary, category, risk, source } = req.query;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        feedback_id ? Number(feedback_id) : null,
        title, summary, category ?? null, risk ?? 'medium', source ?? null,
      );
      return res.status(201).json({ id: r.lastInsertRowid });
    }

    if (action === 'patch-feedback') {
      const { id, status, reply } = req.query;
      const cur = await db.get('SELECT * FROM feedback WHERE id=?', Number(id));
      if (!cur) return res.status(404).json({ error: 'not found' });
      const justResolved = (status === 'awaiting_approval' || status === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      if (justResolved) {
        await db.run(
          `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply),
           resolved_by=?, resolved_at=NOW(), updated_at=NOW() WHERE id=?`,
          status, reply ?? null, aid, Number(id),
        );
      } else {
        await db.run(
          `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply),
           updated_at=NOW() WHERE id=?`,
          status, reply ?? null, Number(id),
        );
      }
      return res.json({ ok: true });
    }

    if (action === 'feedback-msg') {
      const { id, text } = req.query;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?)`,
        Number(id), aid, 'AI ассистент', 'admin', text,
      );
      return res.status(201).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export default router;
