// PWA push: подписка/отписка/тест. Публичный ключ отдаём без авторизации
// (это не секрет — он и должен быть у любого клиента, чтобы получить VAPID).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, asyncHandler } from '../errors.js';
import { getPublicKey, isPushEnabled, pushToUser } from '../services/push.js';

const router = Router();

router.get('/vapid-key', asyncHandler(async (_req, res) => {
  res.json({ enabled: isPushEnabled(), key: getPublicKey() });
}));

router.use(authenticate);

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(500),
    auth: z.string().min(4).max(500),
  }),
});

router.post('/subscribe', asyncHandler(async (req, res) => {
  if (!isPushEnabled()) throw BadRequest('PWA push не настроен на сервере (нет VAPID-ключей)');
  const d = subSchema.parse(req.body);
  const ua = (req.headers['user-agent'] || '').toString().slice(0, 400) || null;
  await db.run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, endpoint)
     DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, last_used_at = NOW()`,
    req.user.id, d.endpoint, d.keys.p256dh, d.keys.auth, ua,
  );
  res.json({ ok: true });
}));

router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const d = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body);
  await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', req.user.id, d.endpoint);
  res.json({ ok: true });
}));

// Отправить тестовый пуш самому себе (для проверки настройки на телефоне).
router.post('/test', asyncHandler(async (req, res) => {
  const r = await pushToUser(req.user.id, {
    title: 'CRM',
    body: 'Тест PWA-уведомлений — работает 🎉',
    link: '#/dashboard',
    tag: 'test',
  });
  res.json({ ok: true, sent: r.sent });
}));

router.get('/status', asyncHandler(async (req, res) => {
  const cnt = await db.get(
    'SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id = ?',
    req.user.id,
  );
  res.json({ enabled: isPushEnabled(), subscriptions: Number(cnt?.n) || 0 });
}));

export default router;
