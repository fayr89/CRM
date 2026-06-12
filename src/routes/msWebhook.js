// Входящий webhook от МойСклад: событие изменения остатков → обновляем
// stock_by_store у конкретных товаров.
//
// Маршрут НЕ требует JWT: вызывается МС извне.
// HMAC-подпись X-Lognex-Signature проверяется если задан MOYSKLAD_WEBHOOK_SECRET.
//
// Раньше при любом stock-вебхуке делали ПОЛНЫЙ re-sync каталога (4255 товаров
// per-UUID → ~30 минут). Это съедало бюджет лямбды и блокировало другие
// вызовы. Сейчас парсим events[].meta.href / stockUpdate.goodMeta.href,
// извлекаем UUID-ы только тех товаров где остаток реально поменялся, и
// дёргаем msFetchStockByProductIds именно по ним. Обычный батч = 1-5 UUID,
// отрабатывает за пару секунд.
import crypto from 'crypto';
import { Router } from 'express';
import { asyncHandler } from '../errors.js';
import { db } from '../db.js';
import { msFetchStockByProductIds } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

// Из href вида .../entity/product/UUID или .../entity/variant/UUID
// возвращает {uuid, kind}. Если не похоже на product/variant — null.
function parseEntityHref(href) {
  if (typeof href !== 'string') return null;
  const m = /\/entity\/(product|variant)\/([0-9a-f-]+)(?:\?|$)/i.exec(href);
  if (!m) return null;
  return { kind: m[1], uuid: m[2] };
}

// Из тела вебхука вытаскивает уникальные UUID товаров/вариантов.
// MoySklad шлёт events: [{ meta: {href: ...}, ... }] или с goodMeta / stockUpdate.
function extractProductUuids(body) {
  const uuids = new Set();
  const events = Array.isArray(body?.events) ? body.events : [];
  for (const ev of events) {
    const candidates = [
      ev?.meta?.href,
      ev?.stockUpdate?.goodMeta?.href,
      ev?.goodMeta?.href,
      ev?.product?.meta?.href,
    ];
    for (const href of candidates) {
      const parsed = parseEntityHref(href);
      if (parsed) uuids.add(parsed.uuid);
    }
  }
  return [...uuids];
}

// POST /api/webhooks/moysklad-stock
// Настройка в МС: создаётся через /api/admin/ms/webhook-stocks (либо в ЛК МС
// → Настройки → Вебхуки).
router.post(
  '/moysklad-stock',
  asyncHandler(async (req, res) => {
    const secret = process.env.MOYSKLAD_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-lognex-signature'] || '';
      const body = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    // Отвечаем немедленно — МС ждёт ответа в пределах ~5с.
    const uuids = extractProductUuids(req.body);
    res.json({ ok: true, events: uuids.length });

    if (!uuids.length) return;
    const token = await getMsToken().catch(() => null);
    if (!token) return;

    // Фоновый sync именно этих товаров.
    try {
      const byId = await msFetchStockByProductIds(token, uuids);
      const present = [];
      const presentJson = [];
      for (const uuid of uuids) {
        const sbs = byId.get(uuid);
        if (sbs && sbs.length) {
          present.push(uuid);
          presentJson.push(JSON.stringify(sbs));
        }
      }
      if (present.length) {
        await db.run(
          `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
           FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
           WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
          present, presentJson,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ms-webhook-stock] update failed:', e?.message);
    }
  }),
);

export default router;
