// TEMP: временный диаг-эндпоинт для AI ежедневного обхода обращений.
// Секрет в query (?secret=...). Удалить сразу после использования.
// Создан: 2026-06-13 daily-run inspiring-cannon-dbesk2
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const DIAG_SECRET = 'diag-2026-0613-ic-r8w2k';
const AI_USER = { id: 0, role: 'admin', name: 'AI ассистент' };

router.use((req, res, next) => {
  if (req.query?.secret !== DIAG_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.user = AI_USER;
  next();
});

// GET ?secret=... — полный дамп: feedback (open+awaiting_approval) с тредами +
//                   ai_proposals (все статусы) с тредами
router.get('/', async (req, res) => {
  try {
    const action = req.query.action || 'read';

    // --- WRITE ACTIONS ---
    if (action === 'post-fb-msg') {
      // ?action=post-fb-msg&fid=N&text=BASE64
      const fid = Number(req.query.fid);
      if (!fid) return res.status(400).json({ error: 'fid required' });
      const text = req.query.text ? Buffer.from(req.query.text, 'base64').toString('utf8') : null;
      if (!text) return res.status(400).json({ error: 'text required (base64)' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', fid);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        fid, 0, 'AI ассистент', 'admin', text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'update-fb') {
      // ?action=update-fb&fid=N&status=awaiting_approval&reply=BASE64
      const fid = Number(req.query.fid);
      if (!fid) return res.status(400).json({ error: 'fid required' });
      const status = req.query.status || null;
      const replyB64 = req.query.reply || null;
      const adminReply = replyB64 ? Buffer.from(replyB64, 'base64').toString('utf8') : null;
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', fid);
      if (!cur) return res.status(404).json({ error: 'feedback not found' });
      const newStatus = status || cur.status;
      await db.run(
        `UPDATE feedback SET status = ?,
           admin_reply = COALESCE(?, admin_reply),
           resolved_at = CASE WHEN ? IN ('awaiting_approval','closed') AND status NOT IN ('awaiting_approval','closed') THEN NOW() ELSE resolved_at END,
           updated_at = NOW()
         WHERE id = ?`,
        newStatus, adminReply, newStatus, fid,
      );
      return res.json({ ok: true, fid, status: newStatus });
    }

    if (action === 'create-proposal') {
      // ?action=create-proposal&title=BASE64&summary=BASE64&category=...&risk=...&source=...&fid=N
      const title = req.query.title ? Buffer.from(req.query.title, 'base64').toString('utf8') : null;
      const summary = req.query.summary ? Buffer.from(req.query.summary, 'base64').toString('utf8') : null;
      if (!title || !summary) return res.status(400).json({ error: 'title and summary required (base64)' });
      const changes = req.query.changes ? Buffer.from(req.query.changes, 'base64').toString('utf8') : null;
      const fid = req.query.fid ? Number(req.query.fid) : null;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        fid || null,
        title,
        summary,
        req.query.category || 'feature',
        req.query.risk || 'medium',
        req.query.source || 'daily-run-2026-06-13',
        changes || null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (action === 'update-proposal') {
      // ?action=update-proposal&pid=N&decision=done&notes=BASE64
      const pid = Number(req.query.pid);
      if (!pid) return res.status(400).json({ error: 'pid required' });
      const decision = req.query.decision;
      if (!decision) return res.status(400).json({ error: 'decision required' });
      const notes = req.query.notes ? Buffer.from(req.query.notes, 'base64').toString('utf8') : null;
      await db.run(
        `UPDATE ai_proposals SET status = ?, admin_notes = COALESCE(?, admin_notes),
           admin_decision_at = NOW(), updated_at = NOW() WHERE id = ?`,
        decision, notes, pid,
      );
      return res.json({ ok: true, pid, decision });
    }

    if (action === 'post-proposal-msg') {
      // ?action=post-proposal-msg&pid=N&text=BASE64
      const pid = Number(req.query.pid);
      if (!pid) return res.status(400).json({ error: 'pid required' });
      const text = req.query.text ? Buffer.from(req.query.text, 'base64').toString('utf8') : null;
      if (!text) return res.status(400).json({ error: 'text required (base64)' });
      const r = await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        pid, 0, 'AI ассистент', 'admin', text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    // --- READ ---
    const feedbacks = await db.all(
      `SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC`,
    );
    for (const fb of feedbacks) {
      fb.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }

    const proposals = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       WHERE p.status IN ('approved','revision','rejected','pending')
       ORDER BY (CASE p.status WHEN 'approved' THEN 0 WHEN 'revision' THEN 1
                WHEN 'pending' THEN 2 ELSE 3 END), p.created_at DESC`,
    );
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ? ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }

    res.json({ feedbacks, proposals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
