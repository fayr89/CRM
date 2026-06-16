// TEMP: daily AI run endpoint — remove after use (2026-06-16-v34)
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr-v34-xQ7mP2kL9nR5';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily?secret=... — all data for daily run
router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const [approved, revision, rejected, pending] = await Promise.all([
      db.all(`SELECT p.*, array_agg(json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL) AS messages
               FROM ai_proposals p LEFT JOIN ai_proposal_messages m ON m.proposal_id=p.id
               WHERE p.status='approved' GROUP BY p.id ORDER BY p.created_at DESC`),
      db.all(`SELECT p.*, array_agg(json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL) AS messages
               FROM ai_proposals p LEFT JOIN ai_proposal_messages m ON m.proposal_id=p.id
               WHERE p.status='revision' GROUP BY p.id ORDER BY p.created_at DESC`),
      db.all(`SELECT p.*, array_agg(json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL) AS messages
               FROM ai_proposals p LEFT JOIN ai_proposal_messages m ON m.proposal_id=p.id
               WHERE p.status='rejected' GROUP BY p.id ORDER BY p.created_at DESC`),
      db.all(`SELECT p.*, array_agg(json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL) AS messages
               FROM ai_proposals p LEFT JOIN ai_proposal_messages m ON m.proposal_id=p.id
               WHERE p.status='pending' GROUP BY p.id ORDER BY p.created_at DESC`),
    ]);

    const feedbackRows = await db.all(`
      SELECT f.id, f.user_id, u.name AS user_name, f.category, f.subject, f.message,
             f.status, f.admin_reply, f.created_at, f.updated_at,
             array_agg(json_build_object('id',m.id,'user_name',m.user_name,'role',m.role,'text',m.text,'created_at',m.created_at) ORDER BY m.created_at,m.id) FILTER (WHERE m.id IS NOT NULL) AS thread
      FROM feedback f
      LEFT JOIN users u ON u.id=f.user_id
      LEFT JOIN feedback_messages m ON m.feedback_id=f.id
      WHERE f.status IN ('open','awaiting_approval')
      GROUP BY f.id,u.name ORDER BY f.created_at ASC`);

    res.json({ approved, revision, rejected, pending, feedback: feedbackRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily?secret=... — perform operations
router.post('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const ops = req.body;
  const results = [];
  try {
    for (const op of ops) {
      if (op.type === 'proposal_done') {
        await db.run(`UPDATE ai_proposals SET status='done', updated_at=NOW() WHERE id=?`, op.id);
        results.push({ op: 'proposal_done', id: op.id, ok: true });
      } else if (op.type === 'proposal_create') {
        const r = await db.run(
          `INSERT INTO ai_proposals (feedback_id,title,summary,category,risk,source,proposed_changes)
           VALUES (?,?,?,?,?,?,?::jsonb) RETURNING id`,
          op.feedback_id ?? null, op.title, op.summary,
          op.category ?? 'feature', op.risk ?? 'medium',
          op.source ?? `daily-run-2026-06-16`,
          op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
        );
        results.push({ op: 'proposal_create', id: r.lastInsertRowid, ok: true });
      } else if (op.type === 'proposal_message') {
        await db.run(
          `INSERT INTO ai_proposal_messages (proposal_id,user_name,role,text) VALUES (?,?,?,?)`,
          op.proposal_id, 'AI ассистент', 'admin', op.text,
        );
        results.push({ op: 'proposal_message', proposal_id: op.proposal_id, ok: true });
      } else if (op.type === 'proposal_patch') {
        const sets = [];
        const vals = [];
        if (op.status) { sets.push('status=?'); vals.push(op.status); }
        if (op.summary !== undefined) { sets.push('summary=?'); vals.push(op.summary); }
        if (op.admin_notes !== undefined) { sets.push('admin_notes=?'); vals.push(op.admin_notes); }
        sets.push('updated_at=NOW()');
        await db.run(`UPDATE ai_proposals SET ${sets.join(',')} WHERE id=?`, ...vals, op.id);
        results.push({ op: 'proposal_patch', id: op.id, ok: true });
      } else if (op.type === 'feedback_message') {
        await db.run(
          `INSERT INTO feedback_messages (feedback_id,user_name,role,text) VALUES (?,?,?,?)`,
          op.feedback_id, 'AI ассистент', 'admin', op.text,
        );
        results.push({ op: 'feedback_message', feedback_id: op.feedback_id, ok: true });
      } else if (op.type === 'feedback_patch') {
        const sets = [];
        const vals = [];
        if (op.status) { sets.push('status=?'); vals.push(op.status); }
        if (op.admin_reply !== undefined) { sets.push('admin_reply=?'); vals.push(op.admin_reply); }
        sets.push('updated_at=NOW()');
        await db.run(`UPDATE feedback SET ${sets.join(',')} WHERE id=?`, ...vals, op.id);
        results.push({ op: 'feedback_patch', id: op.id, ok: true });
      } else {
        results.push({ op: op.type, ok: false, error: 'unknown op' });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message, results });
  }
});

export default router;
