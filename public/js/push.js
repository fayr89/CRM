// PWA Web Push (клиент): подписка/отписка через Service Worker.
// Публичный VAPID-ключ приходит с сервера, base64url → Uint8Array для pushManager.
// window.crmPush.subscribe() запрашивает разрешение и подписывает; unsubscribe() — отменяет.
import { api } from './api.js';

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function isPushSupported() {
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  try {
    const r = await api.pushVapidKey();
    return !!(r && r.enabled && r.key);
  } catch { return false; }
}

// Текущий статус: has permission + subscribed на этом устройстве.
export async function getPushLocalStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  const permission = Notification.permission;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, permission, subscribed: !!sub, subscription: sub };
}

export async function subscribeToPush() {
  const cfg = await api.pushVapidKey();
  if (!cfg?.enabled || !cfg?.key) throw new Error('PWA push не настроен на сервере (нет VAPID-ключей)');
  if (Notification.permission === 'denied') {
    throw new Error('Уведомления заблокированы в браузере. Разреши в настройках сайта.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Разрешение на уведомления не дано');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Если существующая подписка сделана под ДРУГОЙ VAPID (напр. до авто-генерации
  // ключей сервером) — она невалидна на текущем бэке. Отпишемся локально и
  // подпишемся заново под свежий VAPID.
  if (sub) {
    const currentKey = sub.options?.applicationServerKey;
    if (currentKey) {
      const currentB64 = btoa(String.fromCharCode(...new Uint8Array(currentKey)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (currentB64 !== cfg.key) {
        try { await sub.unsubscribe(); } catch { /* ignore */ }
        sub = null;
      }
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // обязательно для Chrome/Firefox
      applicationServerKey: urlB64ToUint8Array(cfg.key),
    });
  }
  await api.pushSubscribe(sub.toJSON());
  return sub;
}

// Синхронизация: если браузер подписан, но у сервера этой подписки нет (протухла
// или не долетела ранее) — отправить локальную подписку на сервер ещё раз.
// Идемпотентно (uniq по user_id+endpoint на бэке).
export async function ensureServerHasSubscription() {
  const st = await getPushLocalStatus();
  if (!st.supported || !st.subscribed || !st.subscription) return false;
  try { await api.pushSubscribe(st.subscription.toJSON()); return true; }
  catch { return false; }
}

export async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return true;
  try { await api.pushUnsubscribe(sub.endpoint); } catch { /* всё равно локально отпишемся */ }
  try { await sub.unsubscribe(); } catch { /* ignore */ }
  return true;
}

export async function sendTestPush() {
  const r = await api.pushTest();
  // Если бэк не нашёл подписок, но локально есть — это классический рассинхрон
  // (подписка была сделана под старым VAPID, или INSERT не долетел). Пробуем
  // ре-синхронизировать и повторить тест.
  if (!r?.sent) {
    const synced = await ensureServerHasSubscription().catch(() => false);
    if (synced) {
      try {
        const retry = await api.pushTest();
        if (retry?.sent) return retry;
      } catch { /* ignore, отдадим исходный */ }
    }
  }
  return r;
}

// Глобальный шорткат для консоли/UI без импорта.
if (typeof window !== 'undefined') {
  window.crmPush = { subscribe: subscribeToPush, unsubscribe: unsubscribeFromPush, status: getPushLocalStatus, test: sendTestPush, resync: ensureServerHasSubscription };
}
