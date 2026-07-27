// PWA Web Push через VAPID. Публичный ключ отдаём фронту, приватным подписываем
// пуш на сервере. Ключи ищем в порядке приоритета:
//   1) env PUSH_VAPID_PUBLIC/PUSH_VAPID_PRIVATE (если админ задал вручную)
//   2) app_settings.push_vapid_keys (авто-сгенерированные при первом запросе)
// Без ключей — авто-генерация и сохранение в app_settings, чтобы push работал
// «из коробки» без ручной настройки env. Приватный ключ хранится в БД в открытом
// виде — тот же уровень секретности, что и МС-токен в app_settings.moysklad.token.
import webpush from 'web-push';
import { db } from '../db.js';

let cached = null; // { publicKey, privateKey, subject }
let configured = false;

async function loadKeysFromDb() {
  try {
    const row = await db.get(`SELECT value FROM app_settings WHERE key = 'push_vapid_keys'`);
    const v = row?.value;
    if (v && v.publicKey && v.privateKey) return { publicKey: v.publicKey, privateKey: v.privateKey };
  } catch { /* app_settings может ещё не быть на первом холодном старте */ }
  return null;
}

async function saveKeysToDb(keys) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('push_vapid_keys', ?::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }),
  );
}

async function resolveKeys() {
  if (cached) return cached;
  const subject = process.env.PUSH_VAPID_SUBJECT || 'mailto:admin@crm.local';
  if (process.env.PUSH_VAPID_PUBLIC && process.env.PUSH_VAPID_PRIVATE) {
    cached = { publicKey: process.env.PUSH_VAPID_PUBLIC, privateKey: process.env.PUSH_VAPID_PRIVATE, subject };
    return cached;
  }
  const fromDb = await loadKeysFromDb();
  if (fromDb) { cached = { ...fromDb, subject }; return cached; }
  // Ни в env, ни в БД — генерируем и сохраняем (одноразово, для всего инстанса CRM).
  const gen = webpush.generateVAPIDKeys();
  await saveKeysToDb(gen).catch((e) => console.error('[push] save VAPID keys:', e.message));
  cached = { publicKey: gen.publicKey, privateKey: gen.privateKey, subject };
  console.log('[push] сгенерированы новые VAPID-ключи и сохранены в app_settings.push_vapid_keys');
  return cached;
}

async function ensureConfigured() {
  if (configured) return true;
  const k = await resolveKeys();
  if (!k?.publicKey || !k?.privateKey) return false;
  webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
  configured = true;
  return true;
}

// Синхронная проверка «включён ли» — исторически некоторые вызовы принимают bool.
// Теперь всегда true (генерируем при необходимости). Оставляем для API-совместимости.
export function isPushEnabled() {
  return true;
}

// Публичный ключ для клиента — асинхронно, чтобы триггернуть авто-генерацию.
export async function getPublicKey() {
  const k = await resolveKeys();
  return k?.publicKey || null;
}

// Пуш одному юзеру по всем его подпискам (устройствам). Ошибки 404/410 (endpoint
// протух) → удаляем подписку. Прочие — логируем, но не роняем notify.
export async function pushToUser(userId, { title, body, link, tag }) {
  if (!userId) return { sent: 0 };
  const ok = await ensureConfigured();
  if (!ok) return { sent: 0 };
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
  const ok = await ensureConfigured();
  if (!ok) return { sent: 0 };
  let total = 0;
  await Promise.all((userIds || []).map(async (id) => {
    const r = await pushToUser(id, message);
    total += r.sent || 0;
  }));
  return { sent: total };
}
