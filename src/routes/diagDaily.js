// ВРЕМЕННЫЙ диагностический роут для ежедневного AI-обхода обращений.
// Секрет в query (единственный способ дойти сюда через web_fetch_vercel_url —
// он умеет только GET, без заголовков). Сносится отдельным коммитом сразу
// после обхода. См. AI-DAILY.md.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const SECRET = '662f39d0a1b723f1d565b7a1e2444233';

async function runOp(op) {
  const { action } = op;
  switch (action) {
    case 'dump_proposals': {
      const where = op.status ? 'WHERE p.status = ?' : '';
      const params = op.status ? [op.status] : [];
      return db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status
         FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id
         ${where} ORDER BY p.created_at DESC`,
        ...params,
      );
    }
    case 'dump_proposal_messages': {
      return db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM ai_proposal_messages
         WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        op.id,
      );
    }
    case 'proposal_patch': {
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
         updated_at = NOW() WHERE id = ?`,
        op.decision,
        op.notes ?? null,
        op.id,
      );
      return db.get('SELECT * FROM ai_proposals WHERE id = ?', op.id);
    }
    case 'proposal_create': {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'pending') RETURNING id`,
        op.feedback_id ?? null,
        op.title,
        op.summary,
        op.category ?? null,
        op.risk || 'medium',
        op.source ?? null,
        op.proposed_changes ? JSON.stringify(op.proposed_changes) : null,
      );
      return { id: r.lastInsertRowid };
    }
    case 'proposal_message': {
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        op.id,
        op.user_name || 'AI ассистент',
        op.text,
      );
      return { id: r.lastInsertRowid };
    }
    case 'dump_feedback': {
      const where = op.status ? 'WHERE f.status = ?' : '';
      const params = op.status ? [op.status] : [];
      return db.all(
        `SELECT f.*, u.name AS user_name, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         ${where} ORDER BY f.created_at ASC`,
        ...params,
      );
    }
    case 'dump_feedback_messages': {
      return db.all(
        `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages
         WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        op.id,
      );
    }
    case 'feedback_patch': {
      const justResolved = op.status === 'awaiting_approval' || op.status === 'closed';
      await db.run(
        `UPDATE feedback SET status = COALESCE(?, status),
         admin_reply = COALESCE(?, admin_reply),
         resolved_at = CASE WHEN ${justResolved} THEN NOW() ELSE resolved_at END,
         updated_at = NOW() WHERE id = ?`,
        op.status ?? null,
        op.admin_reply ?? null,
        op.id,
      );
      return db.get('SELECT * FROM feedback WHERE id = ?', op.id);
    }
    case 'feedback_message': {
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        op.id,
        op.user_name || 'AI ассистент',
        op.text,
      );
      return { id: r.lastInsertRowid };
    }
    case 'check_user': {
      return db.get(
        `SELECT id, email, active, updated_at FROM users WHERE email = ?`,
        op.email,
      );
    }
    case 'meta': {
      const proposals_total = await db.get('SELECT COUNT(*)::int AS n FROM ai_proposals');
      const proposals_by_status = await db.all('SELECT status, COUNT(*)::int AS n FROM ai_proposals GROUP BY status');
      const feedback_by_status = await db.all(`SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`);
      const feedback_open = await db.get(`SELECT COUNT(*)::int AS n FROM feedback WHERE status IN ('open','awaiting_approval')`);
      const last_fb_msg = await db.get('SELECT MAX(created_at) AS t FROM feedback_messages');
      const last_prop = await db.get('SELECT MAX(updated_at) AS t FROM ai_proposals');
      return {
        proposals_total: proposals_total?.n,
        proposals_by_status,
        feedback_by_status,
        feedback_open_count: feedback_open?.n,
        feedback_last_msg: last_fb_msg?.t,
        proposals_last_update: last_prop?.t,
        server_now: new Date().toISOString(),
      };
    }
    default:
      return { error: 'unknown action', action };
  }
}

router.get('/daily', async (req, res) => {
  if (req.query.secret !== SECRET) {
    return res.status(404).json({ error: 'not found' });
  }
  try {
    let ops = [];
    if (req.query.op) {
      ops = JSON.parse(Buffer.from(String(req.query.op), 'base64url').toString('utf8'));
      if (!Array.isArray(ops)) ops = [ops];
    } else if (req.query.action) {
      ops = [{ action: req.query.action, id: req.query.id, status: req.query.status }];
    }
    const results = [];
    for (const op of ops) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await runOp(op));
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
});

export default router;
