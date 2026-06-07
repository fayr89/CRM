// TEMP — одноразовый диаг-роут для AI-обхода 2026-06-07-v15
// Сносится отдельным коммитом сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'daily-run-2026-06-07-v15-m9x4q';

function checkSecret(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// op=feedback-full  — все feedback + threads
// op=proposals&status=X  — ai_proposals
// op=proposal-messages&proposal_id=X — тред предложения
// op=post-feedback-msg&feedback_id=X&text=...&user_name=...
// op=create-proposal&title=...&summary=...&category=...&risk=...&source=...&feedback_id=X&changes=JSON
// op=patch-proposal&id=X&decision=done
// op=patch-feedback&id=X&status=...&reply=...
// op=post-proposal-msg&proposal_id=X&text=...

router.get('/', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const op = req.query.op;

  try {
    if (op === 'feedback-full') {
      const feedbacks = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
                r.name AS resolved_by_name
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
         LEFT JOIN users r ON r.id = f.resolved_by
         WHERE f.status IN ('open','awaiting_approval','in_progress')
         ORDER BY f.created_at DESC`,
      );
      const ids = feedbacks.map(f => f.id);
      let messages = [];
      if (ids.length > 0) {
        messages = await db.all(
          `SELECT feedback_id, id, user_id, user_name, role, text, created_at
           FROM feedback_messages
           WHERE feedback_id = ANY(?)
           ORDER BY created_at ASC, id ASC`,
          ids,
        );
      }
      const msgByFb = {};
      for (const m of messages) {
        if (!msgByFb[m.feedback_id]) msgByFb[m.feedback_id] = [];
        msgByFb[m.feedback_id].push(m);
      }
      return res.json({ data: feedbacks.map(f => ({ ...f, thread: msgByFb[f.id] || [] })) });
    }

    if (op === 'proposals') {
      const status = req.query.status;
      const where = status ? 'WHERE p.status = $1' : '';
      const params = status ? [status] : [];
      const rows = await db.all(
        `SELECT p.*, f.subject AS feedback_subject, f.user_id AS feedback_user_id,
                fu.name AS feedback_author_name
         FROM ai_proposals p
         LEFT JOIN feedback f ON f.id = p.feedback_id
         LEFT JOIN users fu ON fu.id = f.user_id
         ${where}
         ORDER BY p.created_at DESC`,
        ...params,
      );
      return res.json({ data: rows });
    }

    if (op === 'proposal-messages') {
      const pid = Number(req.query.proposal_id);
      if (!pid) return res.status(400).json({ error: 'proposal_id required' });
      const rows = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        pid,
      );
      return res.json({ data: rows });
    }

    if (op === 'post-feedback-msg') {
      const fid = Number(req.query.feedback_id);
      const text = decodeURIComponent(req.query.text || '');
      const userName = decodeURIComponent(req.query.user_name || 'AI ассистент');
      if (!fid || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id, user_id FROM feedback WHERE id = ?', fid);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, ?, 'admin', ?) RETURNING id`,
        fid,
        userName,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'create-proposal') {
      const title = decodeURIComponent(req.query.title || '');
      const summary = decodeURIComponent(req.query.summary || '');
      const category = req.query.category || 'feature';
      const risk = req.query.risk || 'medium';
      const source = req.query.source || 'daily-run-2026-06-07-v15';
      const feedbackId = req.query.feedback_id ? Number(req.query.feedback_id) : null;
      const changesRaw = req.query.changes ? decodeURIComponent(req.query.changes) : null;
      let changes = null;
      if (changesRaw) {
        try { changes = JSON.parse(changesRaw); } catch { changes = null; }
      }
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required' });
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        feedbackId,
        title,
        summary,
        category,
        risk,
        source,
        changes ? JSON.stringify(changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-proposal') {
      const id = Number(req.query.id);
      const decision = req.query.decision;
      if (!id || !decision) return res.status(400).json({ error: 'id and decision required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'patch-feedback') {
      const id = Number(req.query.id);
      const status = req.query.status;
      const reply = req.query.reply ? decodeURIComponent(req.query.reply) : null;
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });
      const cur = await db.get('SELECT id FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status,
        reply,
        id,
      );
      return res.json({ ok: true });
    }

    if (op === 'post-proposal-msg') {
      const pid = Number(req.query.proposal_id);
      const text = decodeURIComponent(req.query.text || '');
      if (!pid || !text) return res.status(400).json({ error: 'proposal_id and text required' });
      const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', pid);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        pid,
        text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    return res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
