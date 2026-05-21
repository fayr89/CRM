// Простой Telegram-бот, который собирает заявки в CRM.
//
// Запуск:
//   1) Создайте бота через @BotFather, получите TELEGRAM_TOKEN.
//   2) Получите CRM API-токен на странице «Интеграции» (роль admin).
//   3) Установите node-telegram-bot-api:  npm install node-telegram-bot-api
//   4) TELEGRAM_TOKEN=... CRM_API_TOKEN=... CRM_URL=https://your-crm.com node examples/telegram-bot.js
//
// Бот опрашивает имя/телефон/сообщение, потом шлёт POST /api/external/leads.
// Заявка появляется в разделе «Лиды», менеджер получает уведомление.

import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CRM_URL = process.env.CRM_URL || 'http://localhost:3000';
const CRM_API_TOKEN = process.env.CRM_API_TOKEN;

if (!TELEGRAM_TOKEN || !CRM_API_TOKEN) {
  console.error('Нужны переменные окружения TELEGRAM_TOKEN и CRM_API_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const sessions = new Map(); // chatId -> { step, data }

const STEPS = [
  { key: 'first_name', prompt: 'Как вас зовут?' },
  { key: 'phone', prompt: 'Оставьте телефон для связи (или напишите «—»):' },
  { key: 'description', prompt: 'Кратко опишите задачу:' },
];

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sessions.set(chatId, { step: 0, data: {} });
  bot.sendMessage(chatId, 'Добрый день! Оставьте заявку — менеджер свяжется.\n\n' + STEPS[0].prompt);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text?.startsWith('/')) return;
  const session = sessions.get(chatId);
  if (!session) return;

  const step = STEPS[session.step];
  session.data[step.key] = msg.text === '—' ? null : msg.text;
  session.step += 1;

  if (session.step < STEPS.length) {
    bot.sendMessage(chatId, STEPS[session.step].prompt);
    return;
  }

  // Все вопросы заданы — отправляем в CRM
  try {
    const res = await fetch(`${CRM_URL}/api/external/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': CRM_API_TOKEN },
      body: JSON.stringify({
        ...session.data,
        source: 'telegram',
        company_name: msg.from?.username ? '@' + msg.from.username : null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    bot.sendMessage(chatId, '✅ Заявка отправлена! С вами свяжутся.');
  } catch (e) {
    bot.sendMessage(chatId, `❌ Не удалось отправить: ${e.message}`);
  } finally {
    sessions.delete(chatId);
  }
});

console.log('Telegram-бот запущен. Pid:', process.pid);
