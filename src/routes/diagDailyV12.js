// TEMP: диагностический эндпоинт для AI daily run 2026-06-25-v12 — УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiday-v12-Jx8Rk3mN';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v12/data — вернуть все proposals + feedback с тредами
router.get('/data', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;

    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.status AS feedback_status
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      ORDER BY p.created_at DESC
    `);

    const proposalMessages = await db.all(`
      SELECT m.* FROM ai_proposal_messages m
      INNER JOIN ai_proposals p ON p.id = m.proposal_id
      ORDER BY m.created_at ASC, m.id ASC
    `);

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role,
             r.name AS resolved_by_name
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.resolved_by
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY
        (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
        f.created_at DESC
    `);

    const feedbackMessages = await db.all(`
      SELECT fm.* FROM feedback_messages fm
      INNER JOIN feedback f ON f.id = fm.feedback_id
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY fm.created_at ASC, fm.id ASC
    `);

    res.json({ adminId, proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/diag/daily-v12/act — выполнить операцию записи
router.post('/act', async (req, res) => {
  if (!guard(req, res)) return;
  const { action, ...data } = req.body || {};
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;
    let result = { ok: true };

    if (action === 'update_proposal') {
      await db.run(
        `UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`,
        data.status, data.id,
      );
    } else if (action === 'create_proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        data.feedback_id ?? null,
        data.title,
        data.summary,
        data.category ?? null,
        data.risk || 'medium',
        data.source ?? null,
        data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
      );
      result = { id: r.lastInsertRowid };
    } else if (action === 'post_proposal_msg') {
      await db.run(
        `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        data.proposal_id, adminId, data.text,
      );
    } else if (action === 'update_feedback') {
      if (data.status) {
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', data.id);
        const justResolved = (data.status === 'awaiting_approval' || data.status === 'closed')
          && cur && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(
          `UPDATE feedback SET
             status = ?,
             admin_reply = COALESCE(?, admin_reply),
             resolved_by = COALESCE(?, resolved_by),
             resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'},
             updated_at = NOW()
           WHERE id = ?`,
          data.status,
          data.admin_reply ?? null,
          justResolved ? adminId : null,
          data.id,
        );
      }
    } else if (action === 'post_feedback_msg') {
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (?, ?, 'AI ассистент', 'admin', ?, NULL::jsonb)`,
        data.feedback_id, adminId, data.text,
      );
    } else {
      return res.status(400).json({ error: 'unknown action: ' + action });
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
