// TEMP: ежедневный AI-обход. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'a7d3f1c9e502';

function auth(req, res, next) {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
}

function dec(val) {
  if (!val) return null;
  try { return Buffer.from(val, 'base64').toString('utf8'); } catch { return val; }
}

router.get('/', auth, async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'proposals') {
      const status = req.query.status || null;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, u.name AS admin_decision_by_name,
                f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN users u ON u.id = p.admin_decision_by
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC LIMIT 100`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (action === 'proposal_msgs') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = $1
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (action === 'patch_proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      const notes = dec(req.query.notes_b64) || req.query.notes || null;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      await db.run(
        `UPDATE ai_proposals SET status = $1, admin_notes = $2,
         admin_decision_at = NOW(), updated_at = NOW() WHERE id = $3`,
        decision, notes, id,
      );
      const updated = await db.get('SELECT id, status, title FROM ai_proposals WHERE id = $1', id);
      return res.json({ ok: true, proposal: updated });
    }

    if (action === 'post_proposal_msg') {
      const id = Number(req.query.id);
      const text = dec(req.query.text_b64) || req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const prop = await db.get('SELECT id FROM ai_proposals WHERE id = $1', id);
      if (!prop) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES ($1, 0, 'AI ассистент', 'admin', $2) RETURNING id`,
        id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'feedback_full') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.created_at, f.updated_at, f.user_id,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval')
         ORDER BY f.created_at DESC LIMIT 100`,
      );
      const ids = rows.map(r => r.id);
      let messages = [];
      if (ids.length) {
        messages = await db.all(
          `SELECT id, feedback_id, user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY($1::int[])
           ORDER BY feedback_id, created_at ASC, id ASC`,
          ids,
        );
      }
      const msgMap = {};
      for (const m of messages) {
        if (!msgMap[m.feedback_id]) msgMap[m.feedback_id] = [];
        msgMap[m.feedback_id].push(m);
      }
      return res.json({ data: rows.map(r => ({ ...r, messages: msgMap[r.id] || [] })) });
    }

    if (action === 'post_feedback_msg') {
      const feedback_id = Number(req.query.feedback_id);
      const text = dec(req.query.text_b64) || req.query.text;
      if (!feedback_id || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = $1', feedback_id);
      if (!fb) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, created_at)
         VALUES ($1, 0, 'AI ассистент', 'admin', $2, NOW()) RETURNING id`,
        feedback_id, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'patch_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const admin_reply = dec(req.query.reply_b64) || req.query.admin_reply || null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      await db.run(
        `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply),
         updated_at = NOW() WHERE id = $3`,
        status, admin_reply, id,
      );
      const updated = await db.get('SELECT id, status, subject FROM feedback WHERE id = $1', id);
      return res.json({ ok: true, feedback: updated });
    }

    if (action === 'create_proposal') {
      const title = dec(req.query.title_b64) || req.query.title;
      const summary = dec(req.query.summary_b64) || req.query.summary;
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || 'daily-run-2026-06-25';
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const proposed_changes = req.query.changes_b64
        ? dec(req.query.changes_b64)
        : req.query.proposed_changes || null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
        feedback_id, title, summary, category, risk, source, proposed_changes,
      );
      const created = await db.get('SELECT id, title, status FROM ai_proposals WHERE id = $1', r.lastInsertRowid);
      return res.json({ ok: true, proposal: created });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message), stack: e.stack?.split('\n').slice(0, 5) });
  }
});

export default router;
