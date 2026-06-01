// Роуты МАХ-бота: webhook (публичный), привязка чата пользователя, админ-настройки.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, asyncHandler } from '../errors.js';
import {
  getMaxBotInfo, getMaxToken, getMaxWebhook,
  setMaxToken, setMaxWebhook,
  generateMaxBindCode, handleMaxUpdate,
} from '../services/max-bot.js';

const router = Router();

// Webhook от МАХ — публичный (МАХ дёргает извне). НЕ требует authenticate.
// Защита: токен бота знаем только мы; webhook URL приватный (только админ
// настраивает). При желании можно добавить ?secret=... к URL и проверять.
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    try {
      await handleMaxUpdate(req.body);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[max webhook]', e.message);
    }
    // Всегда 200 — МАХ может ретраить на 5xx.
    res.json({ ok: true });
  }),
);

// Дальше — авторизованные ручки.
router.use(authenticate);

// Сгенерировать (или вернуть актуальный) код привязки для текущего пользователя.
router.post(
  '/bind-code',
  asyncHandler(async (req, res) => {
    const code = await generateMaxBindCode(req.user.id);
    const bot = await getMaxBotInfo().catch(() => null);
    res.json({
      code,
      bot_username: bot?.username || bot?.name || null,
      expires_in_minutes: 30,
    });
  }),
);

// Отвязать МАХ — сбросить chat_id у текущего пользователя.
router.post(
  '/unbind',
  asyncHandler(async (req, res) => {
    await db.run(
      `UPDATE users SET max_chat_id = NULL, max_bind_code = NULL, max_bind_expires = NULL,
       updated_at = NOW() WHERE id = ?`,
      req.user.id,
    );
    res.json({ ok: true });
  }),
);

// Состояние своей привязки: есть ли chat_id, имя бота.
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const u = await db.get(
      `SELECT max_chat_id IS NOT NULL AS bound FROM users WHERE id = ?`,
      req.user.id,
    );
    res.json({ bound: Boolean(u?.bound) });
  }),
);

// === Админ: настройки бота ===

router.get(
  '/admin/status',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const token = await getMaxToken();
    const webhook = await getMaxWebhook();
    let botInfo = null;
    if (token) {
      try { botInfo = await getMaxBotInfo(); } catch (e) { botInfo = { error: e.message }; }
    }
    const bound = await db.get(`SELECT COUNT(*)::int AS n FROM users WHERE max_chat_id IS NOT NULL`);
    res.json({
      has_token: Boolean(token),
      webhook_url: webhook || null,
      bot: botInfo,
      bound_users: bound?.n || 0,
    });
  }),
);

const tokenSchema = z.object({ token: z.string().min(1).nullable().optional() });
router.post(
  '/admin/token',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.body || {});
    await setMaxToken(token || null);
    res.json({ ok: true });
  }),
);

// Диагностика — пробует разные эндпоинты MAX API и показывает raw-ответы.
// Помогает понять что не так с регистрацией вебхука / форматом API.
router.get(
  '/admin/diagnose',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const { getMaxToken } = await import('../services/max-bot.js');
    const token = await getMaxToken();
    if (!token) return res.json({ error: 'Сначала задайте токен бота в Настройках' });
    const base = process.env.MAX_API_BASE || 'https://botapi.max.ru';
    const tests = [
      { name: 'GET /me', url: `${base}/me?access_token=${encodeURIComponent(token)}` },
      { name: 'GET /subscriptions', url: `${base}/subscriptions?access_token=${encodeURIComponent(token)}` },
    ];
    const out = { base, tests: [] };
    for (const t of tests) {
      const result = { name: t.name, url: t.url.replace(token, '***') };
      try {
        const r = await fetch(t.url, { method: 'GET' });
        result.status = r.status;
        result.ok = r.ok;
        const body = await r.text();
        result.body = body.slice(0, 500);
      } catch (e) {
        result.error = e.message;
      }
      out.tests.push(result);
    }
    res.json(out);
  }),
);

const webhookSchema = z.object({ url: z.string().url() });
router.post(
  '/admin/webhook',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { url } = webhookSchema.parse(req.body || {});
    if (!(await getMaxToken())) throw BadRequest('Сначала задайте токен бота');
    const result = await setMaxWebhook(url);
    res.json({ ok: true, result });
  }),
);

// Тестовая отправка: шлёт текущему пользователю «✅ Тест от CRM».
router.post(
  '/admin/test',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const u = await db.get(`SELECT max_chat_id FROM users WHERE id = ?`, req.user.id);
    if (!u?.max_chat_id) throw BadRequest('Сначала привяжите свой МАХ-аккаунт через «Профиль»');
    const { sendMaxMessage } = await import('../services/max-bot.js');
    await sendMaxMessage(u.max_chat_id, '✅ Тестовое сообщение от CRM. Бот работает.');
    res.json({ ok: true });
  }),
);

export default router;
