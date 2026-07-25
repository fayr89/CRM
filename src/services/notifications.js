import { db } from '../db.js';
import { sendMaxMessage } from './max-bot.js';
import { pushToUser } from './push.js';

// Тело уведомления о заказе: сумма + менеджер + клиент + первые 5 позиций.
// Один шаблон для order.created / reserved / shipped — админ/склад/менеджер
// видят полную картину прямо в МАХ или в колокольчике, без захода в CRM.
export async function buildOrderNotificationBody(orderId) {
  const o = await db.get(
    `SELECT o.client_name, o.total_amount, o.currency, o.marketplace,
            u.name AS manager_name
     FROM orders o LEFT JOIN users u ON u.id = o.manager_id
     WHERE o.id = ?`,
    orderId,
  );
  if (!o) return '';
  const items = await db.all(
    `SELECT name, quantity FROM order_items WHERE order_id = ? ORDER BY id LIMIT 5`,
    orderId,
  );
  const countRow = await db.get(
    `SELECT COUNT(*)::int AS c FROM order_items WHERE order_id = ?`,
    orderId,
  );
  const parts = [];
  parts.push(`💰 ${(o.total_amount || 0).toLocaleString('ru-RU')} ${o.currency || 'RUB'}`);
  if (o.manager_name) parts.push(`👤 ${o.manager_name}`);
  if (o.client_name) parts.push(`🧑 ${o.client_name}`);
  if (o.marketplace) parts.push(`🛒 ${o.marketplace}`);
  let body = parts.join(' · ');
  if (items.length) {
    body += '\n\nСостав:\n' + items.map((i) => `• ${i.name} × ${i.quantity}`).join('\n');
    if (countRow.c > items.length) body += `\n…и ещё ${countRow.c - items.length}`;
  }
  return body;
}

// База: сохраняем в notifications для бейджа-колокольчика, и параллельно дублируем
// в МАХ-бота, если пользователь привязал чат. Сбой пуша не валит запись в БД.
export async function notify(userId, type, title, body, link) {
  if (!userId) return;
  await db.run(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES (?, ?, ?, ?, ?)`,
    userId,
    type,
    title,
    body ?? null,
    link ?? null,
  );
  try {
    const u = await db.get(`SELECT max_chat_id FROM users WHERE id = ?`, userId);
    if (u?.max_chat_id) {
      // Проверяем настройку пользователя: хочет ли он получать этот тип уведомлений в МАХ.
      // Отсутствие записи в user_notification_prefs = включено (default-on).
      const pref = await db.get(
        `SELECT enabled FROM user_notification_prefs
         WHERE user_id = ? AND notification_type = ?`,
        userId, type,
      ).catch(() => null);
      const wantsMaxPush = pref ? pref.enabled : true;
      if (wantsMaxPush) {
        // Хеш-ссылку оборачиваем в полный URL — без этого МАХ не сделает её кликабельной.
        // Используем crm.iitit.ru — это домен через VPS-прокси (доступен из РФ без VPN
        // и совпадает с тем, откуда юзеры ставят PWA: тап на ссылку с MAX-сообщения
        // должен открыть установленное приложение, а не Safari).
        const base = process.env.PUBLIC_URL || 'https://crm.iitit.ru';
        const fullLink = link && link.startsWith('#') ? `${base}/${link}` : link;
        await sendMaxMessage(u.max_chat_id, `${title}${body ? '\n\n' + body : ''}`, fullLink);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notify max]', e.message);
  }
  // PWA Web Push — параллельно с MAX, независимо от него. Если VAPID не настроен,
  // pushToUser вернёт {sent:0} без ошибок. Ошибки внутри пуш-сервиса ловятся там же.
  try { await pushToUser(userId, { title, body, link, tag: type }); } catch (e) {
    console.error('[notify push]', e.message);
  }
}

export async function notifyMany(userIds, type, title, body, link) {
  for (const id of userIds) await notify(id, type, title, body, link);
}

export async function notifyAdminsAndManagers(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role IN ('admin','manager') AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}

export async function notifyAdmins(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role = 'admin' AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}

export async function notifyWarehouse(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role = 'warehouse' AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}
