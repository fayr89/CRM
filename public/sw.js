// Service Worker для PWA-обновлений.
// Зачем: чтобы пользователю, поставившему CRM на домашний экран, не нужно было
// переустанавливать приложение при выходе новой версии. SW отслеживает изменения
// собственного файла → клиент показывает баннер «Доступно обновление» → клик
// перезагружает страницу со свежим кодом.
//
// VERSION стампается на этапе сборки (scripts/minify.mjs). На каждом деплое
// строка меняется → браузер считает sw.js обновлённым → ставит новую версию
// в waiting → шлёт клиенту 'updatefound'.
const VERSION = '__BUILD_VERSION__';

self.addEventListener('install', () => {
  // Не ждём, пока старая версия завершит работу. Новая сразу становится активной
  // после клика юзера по «Обновить» (см. message-handler ниже).
  // skipWaiting() сам по себе не активирует — нужен явный сигнал от клиента.
});

self.addEventListener('activate', (event) => {
  // Берём управление над всеми вкладками сразу после активации.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  // Клиент шлёт {type: 'SKIP_WAITING'} когда юзер кликает «Обновить».
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Без fetch-handler — SW не кеширует и не перехватывает запросы. CRM работает
// онлайн-первым (Vercel serverless), кеш бы только путал. SW существует ТОЛЬКО
// для детекта обновлений: его наличие позволяет браузеру отслеживать смену
// версии sw.js и информировать клиента через `updatefound`.

// PWA push: показать нативное уведомление ОС при получении. Пейлоад — JSON
// {title, body, link, tag}. На iOS PWA работает только для приложений, которые
// юзер добавил на домашний экран (Home Screen), iOS 16.4+.
self.addEventListener('push', (event) => {
  let data = { title: 'CRM', body: '' };
  try { data = event.data ? event.data.json() : data; } catch { /* fallback */ }
  const title = data.title || 'CRM';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { link: data.link || '/' },
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Клик по уведомлению: фокус на уже открытую вкладку CRM (если есть) или новая.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Найти уже открытую вкладку этого origin — навигируем в неё.
    const existing = clientsList.find((c) => 'focus' in c);
    if (existing) {
      try {
        if (link.startsWith('#') && existing.navigate) {
          const url = new URL(existing.url);
          url.hash = link;
          await existing.navigate(url.href);
        } else if ('navigate' in existing) {
          await existing.navigate(link);
        }
      } catch { /* navigate может быть недоступен в некоторых браузерах */ }
      return existing.focus();
    }
    // Открытых нет — новая вкладка.
    const url = link.startsWith('#') ? '/' + link : link;
    return self.clients.openWindow(url);
  })());
});
