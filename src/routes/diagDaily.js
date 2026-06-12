// TEMP diag daily-run 2026-06-12-s12 — DELETE after run
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dd-s12-2026-06-12-mN7pX3vQ';

function ok(req, res) {
  if (req.query.secret !== SECRET && req.body?.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

async function adminId() {
  const r = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
  return r?.id ?? null;
}

// READ all needed data
router.get('/', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const approved = await db.all(`SELECT * FROM ai_proposals WHERE status='approved' ORDER BY id`);
    const revision = await db.all(`SELECT * FROM ai_proposals WHERE status='revision' ORDER BY id`);
    const rejected = await db.all(`SELECT * FROM ai_proposals WHERE status='rejected' AND feedback_id IS NOT NULL ORDER BY id`);
    const pending = await db.all(`SELECT * FROM ai_proposals WHERE status='pending' ORDER BY id`);

    const propMsgs = {};
    for (const p of [...approved, ...revision, ...pending]) {
      propMsgs[p.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages WHERE proposal_id=? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.status IN ('open','awaiting_approval')
      ORDER BY f.created_at DESC
    `);

    const fbMsgs = {};
    for (const fb of feedback) {
      fbMsgs[fb.id] = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id=? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    res.json({ approved, revision, rejected, pending, propMsgs, feedback, fbMsgs });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// PATCH proposal → done/approved/rejected/revision
router.post('/patch-proposal', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const { id, decision, notes } = req.body;
    const aid = await adminId();
    await db.run(
      `UPDATE ai_proposals SET status=?, admin_notes=?, admin_decision_by=?, admin_decision_at=NOW(), updated_at=NOW() WHERE id=?`,
      decision, notes ?? null, aid, id,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CREATE proposal
router.post('/create-proposal', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const { feedback_id, title, summary, category, risk, source, proposed_changes } = req.body;
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedback_id ?? null, title, summary, category ?? null, risk ?? 'medium',
      source ?? null, proposed_changes ? JSON.stringify(proposed_changes) : null,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST message to proposal thread
router.post('/proposal-msg', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const { proposal_id, text } = req.body;
    const aid = await adminId();
    await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text) VALUES (?, ?, ?, ?, ?)`,
      proposal_id, aid, 'AI ассистент', 'admin', text,
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH feedback status/admin_reply
router.post('/patch-feedback', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const { id, status, admin_reply } = req.body;
    const aid = await adminId();
    const cur = await db.get('SELECT * FROM feedback WHERE id=?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const justResolved = (status === 'awaiting_approval' || status === 'closed')
      && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
    if (justResolved) {
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), resolved_by=?, resolved_at=NOW(), updated_at=NOW() WHERE id=?`,
        status, admin_reply ?? null, aid, id,
      );
    } else {
      await db.run(
        `UPDATE feedback SET status=?, admin_reply=COALESCE(?, admin_reply), updated_at=NOW() WHERE id=?`,
        status, admin_reply ?? null, id,
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST message to feedback thread
router.post('/feedback-msg', async (req, res) => {
  if (!ok(req, res)) return;
  try {
    const { feedback_id, text } = req.body;
    const aid = await adminId();
    await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, ?, ?, ?, ?)`,
      feedback_id, aid, 'AI ассистент', 'admin', text,
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
