import { db } from '../db.js';
import { sendMaxMessage } from './max-bot.js';

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
        // PUBLIC_URL (env) приоритетнее, иначе берём прод-домен по умолчанию.
        const base = process.env.PUBLIC_URL || 'https://crm-orcin-six.vercel.app';
        const fullLink = link && link.startsWith('#') ? `${base}/${link}` : link;
        await sendMaxMessage(u.max_chat_id, `${title}${body ? '\n\n' + body : ''}`, fullLink);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[notify max]', e.message);
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
