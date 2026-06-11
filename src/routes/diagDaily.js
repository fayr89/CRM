// TEMP: ежедневный AI-обход 2026-06-11-v4. Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = 'dd-v4-r9xK-2026-06-11';
const router = Router();

router.get('/', async (req, res) => {
  if (req.query.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const action = req.query.action;
  try {
    // --- READ ---
    if (action === 'proposals') {
      const result = {};
      for (const s of ['approved', 'revision', 'rejected', 'pending']) {
        result[s] = await db.all(
          `SELECT p.id, p.feedback_id, p.title, p.summary, p.category, p.risk, p.source,
                  p.status, p.admin_notes, p.created_at, p.updated_at,
                  u.name AS admin_decision_by_name, f.subject AS feedback_subject
           FROM ai_proposals p
           LEFT JOIN users u ON u.id = p.admin_decision_by
           LEFT JOIN feedback f ON f.id = p.feedback_id
           WHERE p.status = ?
           ORDER BY p.created_at DESC`,
          s,
        );
      }
      return res.json(result);
    }

    if (action === 'proposal_messages') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    if (action === 'feedback') {
      const rows = await db.all(
        `SELECT f.id, f.status, f.category, f.subject, f.message, f.admin_reply,
                f.created_at, f.updated_at,
                u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
         ORDER BY f.created_at DESC`,
      );
      return res.json({ data: rows });
    }

    if (action === 'feedback_thread') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        id,
      );
      return res.json({ data: rows });
    }

    // --- WRITE ---
    if (action === 'proposal_done') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.run(
        `UPDATE ai_proposals SET status = 'done', updated_at = NOW() WHERE id = ?`, id,
      );
      return res.json({ ok: true, id });
    }

    if (action === 'create_proposal') {
      const { title, summary, category, risk, source } = req.query;
      const feedback_id = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      if (!title || !summary) return res.status(400).json({ error: 'title/summary required' });
      let proposed_changes = null;
      if (req.query.pc) {
        try { proposed_changes = JSON.parse(req.query.pc); } catch { /* ignore */ }
      }
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedback_id,
        title,
        summary,
        category || 'other',
        risk || 'medium',
        source || 'daily-run-2026-06-11',
        proposed_changes ? JSON.stringify(proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'proposal_message') {
      const id = Number(req.query.id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'id/text required' });
      const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, admin?.id || null, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'feedback_message') {
      const id = Number(req.query.feedback_id);
      const text = req.query.text;
      if (!id || !text) return res.status(400).json({ error: 'feedback_id/text required' });
      const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?) RETURNING id`,
        id, admin?.id || null, text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'feedback_status') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply || null;
      if (!id || !status) return res.status(400).json({ error: 'id/status required' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, reply, id,
      );
      return res.json({ ok: true, id });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
