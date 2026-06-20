// ВРЕМЕННО: ежедневный AI-обход. Снести отдельным коммитом после использования.
// Все операции через GET с секретом; используется только web_fetch_vercel_url.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'dr3j9k2m5x7n';

function b64d(s) {
  if (!s) return undefined;
  return Buffer.from(s, 'base64url').toString('utf8');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
    const op = req.query.op || 'read_all';

    if (op === 'read_all') {
      const proposals = await db.all(`
        SELECT p.id, p.feedback_id, p.title, p.summary, p.category, p.risk, p.source,
               p.status, p.admin_notes, p.admin_decision_at, p.created_at, p.updated_at,
               u.name AS admin_decision_by_name,
               f.subject AS feedback_subject, fu.name AS feedback_author_name
        FROM ai_proposals p
        LEFT JOIN users u ON u.id = p.admin_decision_by
        LEFT JOIN feedback f ON f.id = p.feedback_id
        LEFT JOIN users fu ON fu.id = f.user_id
        ORDER BY p.created_at DESC
        LIMIT 100
      `);
      for (const p of proposals) {
        p.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM ai_proposal_messages WHERE proposal_id = ?
           ORDER BY created_at ASC, id ASC`,
          p.id,
        );
      }
      const feedback = await db.all(`
        SELECT f.id, f.user_id, f.category, f.subject, f.message, f.status,
               f.admin_reply, f.created_at, f.updated_at,
               u.name AS user_name, u.email AS user_email, u.role AS user_role
        FROM feedback f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE f.status IN ('open','in_progress','awaiting_approval')
        ORDER BY f.created_at DESC
        LIMIT 100
      `);
      for (const fb of feedback) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ?
           ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ proposals, feedback });
    }

    if (op === 'mark_done') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id,
      );
      return res.json({ ok: true, id });
    }

    if (op === 'create_proposal') {
      const title = req.query.title || '';
      const summary = b64d(req.query.s64) || req.query.summary || '';
      const category = req.query.category || null;
      const risk = req.query.risk || 'medium';
      const source = req.query.source || null;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changesRaw = b64d(req.query.c64) || null;
      const proposed_changes = changesRaw ? JSON.parse(changesRaw) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id,
        title,
        summary,
        category,
        risk,
        source,
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch_proposal') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const notes = b64d(req.query.n64) ?? req.query.notes;
      const newSummary = b64d(req.query.ns64) ?? req.query.new_summary;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      const sets = ['status = ?', 'updated_at = NOW()'];
      const params = [status];
      if (notes !== undefined) { sets.push('admin_notes = ?'); params.push(notes); }
      if (newSummary !== undefined) { sets.push('summary = ?'); params.push(newSummary); }
      params.push(id);
      await db.run(`UPDATE ai_proposals SET ${sets.join(', ')} WHERE id = ?`, ...params);
      return res.json({ ok: true, id });
    }

    if (op === 'post_proposal_msg') {
      const id = Number(req.query.id);
      const text = b64d(req.query.t64) || req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'proposal not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    if (op === 'post_feedback_msg') {
      const id = Number(req.query.id);
      const text = b64d(req.query.t64) || req.query.text || '';
      if (!id || !text) return res.status(400).json({ error: 'id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', id);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        id,
        text,
      );
      return res.json({ ok: true, msg_id: r.lastInsertRowid });
    }

    if (op === 'update_feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = b64d(req.query.r64) ?? req.query.reply ?? null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      const cur = await db.get('SELECT id, status FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const justResolved = (status === 'awaiting_approval' || status === 'closed')
        && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
      if (justResolved) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
          status, reply, id,
        );
      } else {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW() WHERE id = ?`,
          status, reply, id,
        );
      }
      return res.json({ ok: true, id, new_status: status });
    }

    return res.status(400).json({ error: 'unknown op', op });
  }),
);

export default router;
