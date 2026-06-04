// ВРЕМЕННЫЙ диагностический эндпоинт для AI ежедневного обхода.
// Удалить сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';

const DIAG_SECRET = 'f2c7e91a3d084b65c1a9e2f8b47d5c30';
const router = Router();

function checkSecret(req, res) {
  if (req.query.secret !== DIAG_SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-run?secret=X&action=post-msg&feedback_id=N&text=...
// GET /api/diag/daily-run?secret=X&action=patch-feedback&id=N&status=...&admin_reply=...
router.get('/daily-run', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const action = req.query.action;

    if (action === 'post-msg') {
      const feedbackId = Number(req.query.feedback_id);
      const text = String(req.query.text || '').trim();
      if (!feedbackId || !text) return res.status(400).json({ error: 'feedback_id and text required' });
      const fb = await db.get('SELECT id FROM feedback WHERE id = ?', feedbackId);
      if (!fb) return res.status(404).json({ error: 'feedback not found' });
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, NULL, 'AI ассистент', 'admin', ?)`,
        feedbackId, text,
      );
      return res.json({ ok: true });
    }

    if (action === 'patch-feedback') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
      if (!cur) return res.status(404).json({ error: 'not found' });
      const status = req.query.status || cur.status;
      const adminReply = req.query.admin_reply ? String(req.query.admin_reply) : null;
      await db.run(
        `UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), updated_at = NOW() WHERE id = ?`,
        status, adminReply, id,
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
