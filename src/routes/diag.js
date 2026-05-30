// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
// Постит уточняющие вопросы от лица admin в обсуждение указанных feedback-обращений
// и уведомляет автора через notify().
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { notify } from '../services/notifications.js';

const router = Router();
const SECRET = '8d3bbaced00cadd38466bc34f303a7df75eeb9325b8e649a';

router.post(
  '/seed-clarifications',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' });
    }

    // Берём любого активного админа как author сообщения — для отображения имени.
    const admin = await db.get(
      `SELECT id, name FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`,
    );
    if (!admin) return res.status(500).json({ error: 'no admin user found' });

    const out = [];
    for (const it of items) {
      const fb = await db.get(
        'SELECT id, user_id, subject FROM feedback WHERE id = ?',
        Number(it.feedback_id),
      );
      if (!fb) { out.push({ feedback_id: it.feedback_id, skipped: 'not found' }); continue; }
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
         VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
        fb.id,
        admin.id,
        admin.name,
        String(it.text),
      );
      // Уведомляем автора.
      try {
        if (fb.user_id) {
          await notify(
            fb.user_id,
            'feedback.message',
            `💬 Вопрос по обращению: ${fb.subject}`,
            String(it.text).slice(0, 300),
            '#/my-feedback',
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[diag clarif] notify:', e.message);
      }
      out.push({ feedback_id: fb.id, message_id: r.lastInsertRowid });
    }
    res.json({ ok: true, posted: out });
  }),
);

export default router;
