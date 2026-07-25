// PWA Web Push через VAPID. Публичный ключ отдаём фронту, приватным подписываем
// пуш на сервере. Ключи в env: PUSH_VAPID_PUBLIC / PUSH_VAPID_PRIVATE / PUSH_VAPID_SUBJECT.
// Сгенерировать: `npx web-push generate-vapid-keys` (одноразово, положить в Vercel env).
// Без ключей модуль пассивен — API вернёт disabled, notify() не сломается.
import webpush from 'web-push';
import { db } from '../db.js';

let configured = false;

export function isPushEnabled() {
  return !!(process.env.PUSH_VAPID_PUBLIC && process.env.PUSH_VAPID_PRIVATE);
}

function ensureConfigured() {
  if (configured || !isPushEnabled()) return isPushEnabled();
  webpush.setVapidDetails(
    process.env.PUSH_VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.PUSH_VAPID_PUBLIC,
    process.env.PUSH_VAPID_PRIVATE,
  );
  configured = true;
  return true;
}

export function getPublicKey() {
  return process.env.PUSH_VAPID_PUBLIC || null;
}

// Пуш одному юзеру по всем его подпискам (устройствам). Ошибки 404/410 (endpoint
// протух) → удаляем подписку. Прочие — логируем, но не роняем notify.
export async function pushToUser(userId, { title, body, link, tag }) {
  if (!ensureConfigured() || !userId) return { sent: 0 };
  const subs = await db.all(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    userId,
  ).catch(() => []);
  if (!subs.length) return { sent: 0 };
  const payload = JSON.stringify({
    title: title || 'CRM',
    body: body || '',
    link: link || null,
    tag: tag || null,
  });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24 }, // 24ч — сообщение перестанет доставляться (актуальность потеряна).
      );
      sent += 1;
      // last_used_at не обязательно, обновляем best-effort.
      db.run('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ?', s.id).catch(() => {});
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        // Подписка «протухла» (юзер удалил PWA/отключил уведомления).
        await db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id).catch(() => {});
      } else {
        console.error('[push] send:', e?.statusCode, e?.body?.slice?.(0, 200) || e.message);
      }
    }
  }));
  return { sent };
}

export async function pushToMany(userIds, message) {
  if (!ensureConfigured()) return { sent: 0 };
  let total = 0;
  await Promise.all((userIds || []).map(async (id) => {
    const r = await pushToUser(id, message);
    total += r.sent || 0;
  }));
  return { sent: total };
}
