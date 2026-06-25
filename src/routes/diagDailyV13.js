// TEMP: диагностический эндпоинт для AI daily run 2026-06-25-v13 — УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiday-v13-Qp7Ws2nL';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v13/data — вернуть все proposals + feedback с тредами
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
      SELECT f.*, u.name AS user_name_from_users, u.email AS user_email, u.role AS user_role,
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

export default router;
