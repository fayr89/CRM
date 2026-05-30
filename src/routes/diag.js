// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { notify } from '../services/notifications.js';

const router = Router();
const SECRET = '7a88f5b8d2870844db27816461f1097d92075ae23fbc7327';

const REPLY_12 = `Здравствуйте, Владимир! Поправил, пожалуйста проверьте.

Что было: на странице «📋 Мои обращения» клик по обращению не открывал переписку — это была недоработка интерфейса.

Что сделал:
1) В таблице остальных обращений добавил явную кнопку «💬 Открыть» — теперь однозначно понятно, куда жать.
2) В оранжевых карточках (где «✅ Принимаю / ↩️ Не принято») переписка теперь видна сразу внизу — раскрывается блок «💬 Переписка по обращению» (можно свернуть кликом по заголовку).
3) Рядом с кнопками «Принимаю/Не принято» добавил «💬 Открыть переписку в окне» — на случай если хочется отдельную модалку.

ВАЖНО: чтобы увидеть изменения, обновите страницу с зажатым Ctrl (Cmd на Mac) — иначе браузер покажет старую версию из кеша.

Подтвердите кнопкой «✅ Принимаю», если работает, или верните в работу с описанием что не так.`;

router.get(
  '/seed-r12',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const admin = await db.get(
      `SELECT id, name FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`,
    );
    if (!admin) return res.status(500).json({ error: 'no admin' });
    const fb = await db.get('SELECT id, user_id, subject, status FROM feedback WHERE id = 12');
    if (!fb) return res.status(404).json({ error: 'feedback #12 not found' });

    const existing = await db.get(
      `SELECT id FROM feedback_messages WHERE feedback_id = 12 AND role = 'admin' LIMIT 1`,
    );
    if (existing) return res.json({ skipped: 'already replied' });

    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
      fb.id, admin.id, admin.name, REPLY_12,
    );
    let statusChanged = false;
    if (fb.status !== 'awaiting_approval' && fb.status !== 'closed') {
      await db.run(
        `UPDATE feedback SET status = 'awaiting_approval',
         admin_reply = 'Поправил UX: явные кнопки + раскрытая переписка в awaiting-карточках.',
         resolved_by = ?, resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        admin.id, fb.id,
      );
      statusChanged = true;
    }
    try {
      if (fb.user_id) {
        await notify(
          fb.user_id,
          statusChanged ? 'feedback.awaiting_approval' : 'feedback.message',
          statusChanged
            ? `📮 Подтвердите выполнение: ${fb.subject}`
            : `💬 Вопрос по обращению: ${fb.subject}`,
          REPLY_12.slice(0, 300),
          '#/my-feedback',
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[diag r12] notify:', e.message);
    }
    res.json({ ok: true, message_id: r.lastInsertRowid, status_changed: statusChanged });
  }),
);

export default router;
