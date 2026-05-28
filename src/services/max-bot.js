// Клиент бот-API МАХ. ВНИМАНИЕ: эндпоинты МАХ относительно молодые — если
// после деплоя что-то не отправляется, в первую очередь проверить актуальные
// пути в официальной документации https://dev.max.ru/ и при необходимости
// поправить пути ниже. Базовый принцип (бот-токен в query, JSON-боди для
// сообщений, webhook через PUT /subscriptions) — типовой.
import { db } from '../db.js';
import { decryptSecret, encryptSecret } from './secrets.js';

const MAX_API_BASE = process.env.MAX_API_BASE || 'https://botapi.max.ru';

async function getSetting(key) {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = ?`, key).catch(() => null);
  return row?.value ?? null;
}

async function setSetting(key, value) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    key,
    JSON.stringify(value),
  );
}

export async function getMaxToken() {
  const raw = await getSetting('max.bot_token');
  if (!raw) return process.env.MAX_BOT_TOKEN || null;
  try {
    return decryptSecret(raw);
  } catch {
    return null;
  }
}

export async function setMaxToken(plainToken) {
  if (!plainToken) {
    await db.run(`DELETE FROM app_settings WHERE key = 'max.bot_token'`);
    return;
  }
  await setSetting('max.bot_token', encryptSecret(plainToken));
}

export async function getMaxBotInfo() {
  const token = await getMaxToken();
  if (!token) return null;
  const r = await fetch(`${MAX_API_BASE}/me?access_token=${encodeURIComponent(token)}`, {
    method: 'GET',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`MAX getMe: ${r.status} ${text.slice(0, 200)}`);
  }
  return await r.json();
}

// Отправить текст в чат с user_id (chat_id из webhook'а при /start).
// link — опциональная HTTPS-ссылка: добавим строкой в конец, бот сам её сделает кликабельной.
export async function sendMaxMessage(chatId, text, link) {
  if (!chatId) return { skipped: true, reason: 'no chat_id' };
  const token = await getMaxToken();
  if (!token) return { skipped: true, reason: 'no token' };
  const fullText = link ? `${text}\n\n🔗 ${link}` : text;
  const r = await fetch(
    `${MAX_API_BASE}/messages?user_id=${encodeURIComponent(chatId)}&access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: fullText }),
    },
  );
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`MAX sendMessage: ${r.status} ${body.slice(0, 200)}`);
  }
  return await r.json().catch(() => ({ ok: true }));
}

// Зарегистрировать webhook у бота. URL должен быть HTTPS-доступным извне.
// МАХ присылает обновления типа "message_created" — нам этого хватает для /start.
export async function setMaxWebhook(webhookUrl) {
  const token = await getMaxToken();
  if (!token) throw new Error('Токен МАХ не настроен');
  const r = await fetch(`${MAX_API_BASE}/subscriptions?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, update_types: ['message_created'] }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`MAX setWebhook: ${r.status} ${body.slice(0, 200)}`);
  }
  await setSetting('max.webhook_url', webhookUrl);
  return await r.json().catch(() => ({ ok: true }));
}

export async function getMaxWebhook() {
  return await getSetting('max.webhook_url');
}

// Генерирует одноразовый код привязки для пользователя. TTL — 30 минут.
// Пользователь идёт в бота и шлёт /start <CODE>, webhook ловит и сохраняет chat_id.
export async function generateMaxBindCode(userId) {
  // 6 цифр — легко набрать на телефоне.
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.run(
    `UPDATE users SET max_bind_code = ?, max_bind_expires = NOW() + INTERVAL '30 minutes',
     updated_at = NOW() WHERE id = ?`,
    code,
    userId,
  );
  return code;
}

// Обработка входящего webhook-обновления от МАХ. Возвращает true, если событие
// было /start <CODE> и привязка успешна — в этом случае бот ответит пользователю.
export async function handleMaxUpdate(update) {
  // Формат сообщения: { update_type: 'message_created', message: { sender: { user_id }, body: { text } } }
  // Запасные варианты полей — на случай мелких отличий в схеме (мы не контролируем).
  if (!update) return null;
  const msg = update.message || update.payload?.message || update;
  const text = (msg?.body?.text || msg?.text || '').trim();
  const senderId = msg?.sender?.user_id || msg?.from?.user_id || msg?.chat?.chat_id;
  if (!senderId || !text) return null;

  const m = text.match(/^\/start(?:\s+(\d{4,8}))?/i);
  if (!m) {
    // Любая другая команда — ответим подсказкой.
    await sendMaxMessage(
      senderId,
      'Привет! Я бот CRM. Чтобы подписаться на уведомления, открой профиль в CRM, скопируй код привязки и пришли мне командой:\n/start КОД',
    ).catch(() => {});
    return null;
  }
  const code = m[1];
  if (!code) {
    await sendMaxMessage(
      senderId,
      'Пришлите команду в формате:\n/start КОД\n\nКод можно получить в CRM в профиле («Подключить МАХ»).',
    ).catch(() => {});
    return null;
  }
  const user = await db.get(
    `SELECT id, name FROM users WHERE max_bind_code = ? AND max_bind_expires > NOW()`,
    code,
  );
  if (!user) {
    await sendMaxMessage(senderId, '❌ Код не найден или истёк. Сгенерируйте новый в CRM.').catch(() => {});
    return null;
  }
  await db.run(
    `UPDATE users SET max_chat_id = ?, max_bind_code = NULL, max_bind_expires = NULL,
     updated_at = NOW() WHERE id = ?`,
    senderId,
    user.id,
  );
  await sendMaxMessage(
    senderId,
    `✅ Привет, ${user.name || 'коллега'}! Уведомления подключены — теперь буду присылать события CRM сюда.`,
  ).catch(() => {});
  return { bound_user_id: user.id };
}
