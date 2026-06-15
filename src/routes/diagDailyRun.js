// ВРЕМЕННЫЙ диагностический эндпоинт для ежедневного обхода AI.
// Удалить сразу после использования отдельным коммитом.
// Секрет: pN5wX8qR — одноразовый, только для этой сессии.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = 'pN5wX8qR';

router.use((req, res, next) => {
  if (req.query.tok !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// GET q=proposals[&status=X] — предложения с тредами
// GET q=feedback-full — все open/awaiting_approval фидбеки с тредами
// GET op=patch-proposal&id=X&status=done
// GET op=create-proposal&fid=X&title=...&summary=...&risk=...&cat=...&src=...&changes=...
// GET op=post-proposal-msg&id=X&text=...
// GET op=post-feedback-msg&id=X&text=...
// GET op=patch-feedback&id=X&status=...&reply=...

router.get('/', asyncHandler(async (req, res) => {
  const { q, op } = req.query;

  if (q === 'proposals') {
    const status = req.query.status || null;
    const rows = status
      ? await db.all(
          `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                  fu.name AS feedback_author_name
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           LEFT JOIN users fu ON fu.id = f.user_id
           WHERE p.status = ?
           ORDER BY p.created_at DESC`,
          status,
        )
      : await db.all(
          `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                  fu.name AS feedback_author_name
           FROM ai_proposals p
           LEFT JOIN feedback f ON f.id = p.feedback_id
           LEFT JOIN users fu ON fu.id = f.user_id
           ORDER BY p.created_at DESC`,
        );
    const withThreads = await Promise.all(rows.map(async (p) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
      return { ...p, messages: msgs };
    }));
    return res.json({ data: withThreads });
  }

  if (q === 'feedback-full') {
    const rows = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval')
       ORDER BY f.created_at DESC`,
    );
    const withThreads = await Promise.all(rows.map(async (fb) => {
      const msgs = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
      return { ...fb, messages: msgs };
    }));
    return res.json({ data: withThreads });
  }

  if (op === 'patch-proposal') {
    const id = Number(req.query.id);
    const status = String(req.query.status || '');
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      status, id,
    );
    const row = await db.get('SELECT id, status, title FROM ai_proposals WHERE id = ?', id);
    return res.json({ ok: true, proposal: row });
  }

  if (op === 'create-proposal') {
    const feedbackId = req.query.fid ? Number(req.query.fid) : null;
    const title = String(req.query.title || '');
    const summary = String(req.query.summary || '');
    const risk = String(req.query.risk || 'medium');
    const category = String(req.query.cat || 'feature');
    const source = String(req.query.src || 'daily-run-2026-06-15');
    const changesRaw = req.query.changes ? String(req.query.changes) : null;
    if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
    let changes = null;
    if (changesRaw) {
      try { changes = JSON.parse(changesRaw); } catch { changes = null; }
    }
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      feedbackId, title, summary, category, risk, source,
      changes ? JSON.stringify(changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    return res.status(201).json(created);
  }

  if (op === 'post-proposal-msg') {
    const id = Number(req.query.id);
    const text = String(req.query.text || '');
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'post-feedback-msg') {
    const id = Number(req.query.id);
    const text = String(req.query.text || '');
    if (!id || !text) return res.status(400).json({ error: 'id and text required' });
    const fb = await db.get('SELECT id FROM feedback WHERE id = ?', id);
    if (!fb) return res.status(404).json({ error: 'not found' });
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, 0, 'AI ассистент', 'admin', ?) RETURNING id`,
      id, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  if (op === 'patch-feedback') {
    const id = Number(req.query.id);
    const status = req.query.status ? String(req.query.status) : null;
    const reply = req.query.reply ? String(req.query.reply) : null;
    if (!id || (!status && !reply)) return res.status(400).json({ error: 'id and status/reply required' });
    const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const newStatus = status ?? cur.status;
    await db.run(
      `UPDATE feedback SET
         status = ?,
         admin_reply = COALESCE(?, admin_reply),
         updated_at = NOW()
       WHERE id = ?`,
      newStatus, reply, id,
    );
    const row = await db.get('SELECT id, status, subject FROM feedback WHERE id = ?', id);
    return res.json({ ok: true, feedback: row });
  }

  return res.status(400).json({ error: 'unknown q/op' });
}));

export default router;
