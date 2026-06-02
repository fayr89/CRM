// TEMP: ежедневный обход AI. Удалить после использования.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'diag-2026-06-02-x7r4k9';
const router = Router();

router.get('/', async (req, res) => {
  if (req.query.s !== SECRET) return res.status(403).json({ error: 'forbidden' });
  const { a } = req.query;
  try {
    // get — вернуть все данные для обхода
    if (!a || a === 'get') {
      const approved = await db.all(
        `SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = 'approved' ORDER BY p.created_at DESC`,
      );
      const revision = await db.all(
        `SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = 'revision' ORDER BY p.created_at DESC`,
      );
      const rejected = await db.all(
        `SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         WHERE p.status = 'rejected' AND p.updated_at > NOW() - INTERVAL '7 days'
         ORDER BY p.updated_at DESC`,
      );
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at ASC`,
      );
      for (const fb of feedbacks) {
        fb.messages = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at
           FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
      }
      return res.json({ approved, revision, rejected, feedbacks });
    }

    // msg — добавить сообщение в тред обращения от AI ассистента
    if (a === 'msg') {
      const fid = Number(req.query.fid);
      const txt = String(req.query.txt || '');
      if (!fid || !txt) return res.status(400).json({ error: 'fid and txt required' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        fid, txt,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // fb — обновить статус/ответ обращения
    if (a === 'fb') {
      const fid = Number(req.query.fid);
      if (!fid) return res.status(400).json({ error: 'fid required' });
      const st = req.query.st || null;
      const reply = req.query.reply || null;
      await db.run(
        `UPDATE feedback SET
           status = COALESCE(?, status),
           admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW()
         WHERE id = ?`,
        st, reply, fid,
      );
      return res.json({ ok: true });
    }

    // prop — создать ai_proposal
    if (a === 'prop') {
      const fid = req.query.fid ? Number(req.query.fid) : null;
      const t = String(req.query.t || '');
      const s = String(req.query.s || '');
      const cat = String(req.query.cat || 'feature');
      const risk = String(req.query.risk || 'medium');
      if (!t || !s) return res.status(400).json({ error: 't and s required' });
      let changes = null;
      if (req.query.changes) {
        try { changes = JSON.parse(req.query.changes); } catch { /* skip */ }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, 'daily-run-2026-06-02', ?::jsonb) RETURNING id`,
        fid, t, s, cat, risk,
        changes ? JSON.stringify(changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // done-prop — пометить proposal выполненным
    if (a === 'done-prop') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`,
        id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
