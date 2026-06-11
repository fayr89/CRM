// Входящий webhook от МойСклад: событие stock.change → обновляем остатки.
// Маршрут НЕ требует JWT: вызывается МС извне.
// HMAC-подпись X-Lognex-Signature проверяется если задан MOYSKLAD_WEBHOOK_SECRET.
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

// POST /api/webhooks/moysklad-stock
// Настройка в МС: ЛК → Настройки → Вебхуки → добавить URL и Secret.
// Принимает события stock.change. Отвечает 200 немедленно, sync — фоново.
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

    // Отвечаем немедленно — МС ждёт ответа не более нескольких секунд.
    res.json({ ok: true });

    // Фоновая синхронизация остатков по страницам.
    const token = await getMsToken().catch(() => null);
    if (!token) return;

    const PAGE = 50;
    let offset = 0;
    for (;;) {
      const products = await db.all(
        `SELECT id, external_id FROM products
         WHERE external_source = 'moysklad' AND external_id IS NOT NULL
           AND is_markdown IS NOT TRUE AND active = TRUE
         ORDER BY id LIMIT ? OFFSET ?`,
        PAGE, offset,
      ).catch(() => []);
      if (!products.length) break;

      const ids = products.map((p) => p.external_id);
      const byId = await msFetchStockByProductIds(token, ids).catch(() => null);
      if (!byId) break;

      const present = [];
      const presentJson = [];
      const absent = [];
      for (const p of products) {
        const sbs = byId.get(p.external_id);
        if (sbs && sbs.length) {
          present.push(p.external_id);
          presentJson.push(JSON.stringify(sbs));
        } else {
          absent.push(p.external_id);
        }
      }
      await db.withTransaction(async (tx) => {
        if (present.length) {
          await tx.run(
            `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
             FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
             WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
            present, presentJson,
          );
        }
        if (absent.length) {
          await tx.run(
            `UPDATE products SET stock_by_store = NULL, updated_at = NOW()
             WHERE external_source = 'moysklad' AND external_id = ANY(?)
               AND is_markdown IS NOT TRUE`,
            absent,
          );
        }
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[ms-webhook-stock] db update error:', e?.message);
      });

      offset += products.length;
      if (products.length < PAGE) break;
    }
  }),
);

export default router;
