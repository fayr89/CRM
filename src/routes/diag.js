// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
// Переподписывает все мои авто-ответы в feedback_messages на «AI ассистент».
// Критерий: role='admin' И длина > 100 символов (отсекаем короткие реплики
// настоящего админа типа «Проверил?», «1», «готово»).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '17bee2d2d62a93048e158a4f5e4a1cf7506cacb74bb08f93';

router.get(
  '/rename-ai',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    // Сначала — превью того, что обновим (для проверки).
    const preview = await db.all(
      `SELECT id, feedback_id, user_name, length(text) AS len,
              substring(text from 1 for 60) AS head
       FROM feedback_messages
       WHERE role = 'admin' AND length(text) > 100 AND user_name <> 'AI ассистент'
       ORDER BY id`,
    );
    if (req.query.dry === '1') {
      return res.json({ would_update: preview.length, preview });
    }
    const result = await db.run(
      `UPDATE feedback_messages SET user_name = 'AI ассистент'
       WHERE role = 'admin' AND length(text) > 100 AND user_name <> 'AI ассистент'`,
    );
    res.json({ ok: true, updated: result.changes ?? 0, preview });
  }),
);

export default router;
