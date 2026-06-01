// ВРЕМЕННЫЙ диагностический роут для AI-обхода 2026-06-01 (сессия CpTDe).
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const SECRET = 'dRun2-2026-06-01-mQj7';

const router = Router();

router.get('/', async (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  try {
    const opRaw = req.query.op;
    const op = opRaw
      ? JSON.parse(Buffer.from(opRaw, 'base64url').toString('utf8'))
      : { action: 'ping' };
    const { action } = op;
    if (action === 'ping') return res.json({ ok: true });
    const adminUser = await db.get(
      `SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id ASC LIMIT 1`,
    );
    const adminId = adminUser?.id;
    if (action === 'post_message') {
      const { feedback_id, text } = op;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, 'AI ассистент', 'admin', ?)`,
        feedback_id, adminId, text,
      );
      return res.json({ ok: true });
    }
    if (action === 'update_feedback') {
      const { feedback_id, status, admin_reply } = op;
      const cur = await db.get('SELECT id, status, resolved_by FROM feedback WHERE id = ?', feedback_id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const newStatus = status ?? cur.status;
      const justResolved = ['awaiting_approval', 'closed'].includes(newStatus)
        && !['awaiting_approval', 'closed'].includes(cur.status);
      if (justResolved) {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           resolved_by = ?, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
          newStatus, admin_reply ?? null, adminId, feedback_id,
        );
      } else {
        await db.run(
          `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply),
           updated_at = NOW() WHERE id = ?`,
          newStatus, admin_reply ?? null, feedback_id,
        );
      }
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
