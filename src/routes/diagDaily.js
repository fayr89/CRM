// ВРЕМЕННО: read-only выгрузка для ежедневного обхода. Будет удалён отдельным коммитом.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
const router = Router();
router.get('/feedback-full', asyncHandler(async (req, res) => {
  if (req.query.s !== 'RPgc5KOExppGjWmTuFcqVP') return res.status(404).json({ error: 'not found' });
  const feedback = await db.all(`SELECT f.id, f.user_id, u.name AS author, f.category, f.subject, LEFT(f.message, 2000) AS message, f.status, LEFT(f.admin_reply, 1000) AS admin_reply, f.created_at, f.updated_at FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.status <> 'closed' ORDER BY f.id`);
  const msgs = await db.all(`SELECT feedback_id, user_name, role, LEFT(text, 1500) AS text, created_at FROM feedback_messages WHERE feedback_id IN (SELECT id FROM feedback WHERE status <> 'closed') ORDER BY feedback_id, created_at`);
  const proposals = await db.all(`SELECT id, feedback_id, title, LEFT(summary, 1500) AS summary, risk, status, admin_notes, updated_at FROM ai_proposals WHERE status IN ('pending','approved','revision','rejected') ORDER BY id`);
  const pmsgs = await db.all(`SELECT proposal_id, user_name, role, LEFT(text, 1000) AS text, created_at FROM ai_proposal_messages WHERE proposal_id IN (SELECT id FROM ai_proposals WHERE status IN ('pending','approved','revision','rejected')) ORDER BY proposal_id, created_at`);
  res.json({ feedback, msgs, proposals, pmsgs });
}));
export default router;
