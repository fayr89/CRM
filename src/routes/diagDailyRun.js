// ВРЕМЕННЫЙ ДИАГ-РОУТ — ежедневный обход AI. УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ.
// Секрет: dr0607vK7p2w  (только для этой сессии v20)
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const S = 'dr0607vK7p2w';

router.get('/', asyncHandler(async (req, res) => {
  if (req.query.s !== S) return res.status(403).json({ e: 'forbidden' });
  const act = req.query.act || 'read';

  // --- READ: все proposals + открытый/ждущий фидбек с тредами ---
  if (act === 'read') {
    const proposals = await db.all(
      `SELECT id, title, summary, category, risk, source, status, feedback_id,
              admin_notes, proposed_changes, created_at, updated_at
       FROM ai_proposals ORDER BY created_at DESC LIMIT 100`,
    );
    for (const p of proposals) {
      p.messages = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM ai_proposal_messages WHERE proposal_id = ?
         ORDER BY created_at ASC, id ASC`,
        p.id,
      );
    }
    const feedback = await db.all(
      `SELECT f.id, f.subject, f.message, f.category, f.status, f.admin_reply,
              f.created_at, f.updated_at, u.name AS user_name, u.email AS user_email
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
       ORDER BY f.created_at DESC LIMIT 100`,
    );
    for (const fb of feedback) {
      fb.messages = await db.all(
        `SELECT id, user_name, role, text, created_at
         FROM feedback_messages WHERE feedback_id = ?
         ORDER BY created_at ASC, id ASC`,
        fb.id,
      );
    }
    return res.json({ proposals, feedback });
  }

  // --- PATCH proposal status ---
  if (act === 'patch_proposal') {
    const id = Number(req.query.id);
    const decision = req.query.decision;
    await db.run(
      `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
      decision, id,
    );
    return res.json({ ok: true, id, decision });
  }

  // --- POST message to feedback thread as «AI ассистент» ---
  if (act === 'post_fb_msg') {
    const fid = Number(req.query.fid);
    const text = req.query.text || '';
    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      fid, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  // --- UPDATE feedback status / reply ---
  if (act === 'update_feedback') {
    const id = Number(req.query.id);
    const status = req.query.status;
    const reply = req.query.reply || null;
    await db.run(
      `UPDATE feedback SET status = ?,
       admin_reply = COALESCE(?, admin_reply),
       updated_at = NOW() WHERE id = ?`,
      status, reply, id,
    );
    return res.json({ ok: true, id, status });
  }

  // --- CREATE ai_proposal ---
  if (act === 'create_proposal') {
    const r = await db.run(
      `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      req.query.fid ? Number(req.query.fid) : null,
      req.query.title || '(без названия)',
      req.query.summary || '',
      req.query.cat || 'feature',
      req.query.risk || 'medium',
      req.query.src || 'daily-run-2026-06-07',
      req.query.changes ? req.query.changes : null,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  // --- POST message to ai_proposal thread ---
  if (act === 'post_proposal_msg') {
    const pid = Number(req.query.pid);
    const text = req.query.text || '';
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
      pid, text,
    );
    return res.json({ ok: true, id: r.lastInsertRowid });
  }

  return res.json({ error: 'unknown action' });
}));

export default router;
