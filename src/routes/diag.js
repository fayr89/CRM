// ВРЕМЕННЫЙ диагностический роут — удалить после одного использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '5ec532e908cce5831d1141604729fba3';

router.get(
  '/feedback-full',
  asyncHandler(async (req, res) => {
    if (req.query.secret !== SECRET) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const feedback = await db.all(
      `SELECT f.id, f.status, f.category, f.subject, f.message,
              f.admin_reply, f.created_at, f.updated_at,
              u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status IN ('open','awaiting_approval','in_progress')
       ORDER BY f.created_at DESC
       LIMIT 100`,
    );
    const ids = feedback.map(r => r.id);
    let messages = [];
    if (ids.length) {
      messages = await db.all(
        `SELECT id, feedback_id, user_name, role, text, created_at
         FROM feedback_messages
         WHERE feedback_id = ANY(?::int[])
         ORDER BY feedback_id, created_at ASC, id ASC`,
        `{${ids.join(',')}}`,
      );
    }
    const proposals = await db.all(
      `SELECT id, status, title, summary, category, risk, source,
              feedback_id, admin_notes, created_at
       FROM ai_proposals
       WHERE status IN ('approved','revision','rejected')
       ORDER BY created_at DESC`,
    );
    res.json({ feedback, messages, proposals });
  }),
);

export default router;
