// Cron-эндпоинты, дёргаются автоматически Vercel Cron (см. vercel.json crons).
// Авторизация: Vercel при наличии env CRON_SECRET сам добавит заголовок
// Authorization: Bearer ${CRON_SECRET}. Если env не задана — endpoint открытый
// (только лишние МС-запросы при злоупотреблении).
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { decryptSecret } from '../services/secrets.js';
import { fetchMoyskladStockByStorePage } from '../services/moysklad.js';
import { applyLocalStockReserveDelta } from '../services/ms-orders.js';
import { enqueueMsJob } from '../services/ms-jobs.js';

const router = Router();

function verifyCron(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // eslint-disable-next-line no-console
    console.warn('[cron] CRON_SECRET не задан в env — endpoint /api/cron/* открыт.');
    return true;
  }
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${expected}`;
}

async function getMoyskladToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  if (row?.value) {
    try { return decryptSecret(row.value); } catch { /* ignore */ }
  }
  return process.env.MOYSKLAD_TOKEN || null;
}

// Auto-импорт остатков по складам. Vercel Cron дёргает каждые 15 мин (см. vercel.json).
// Лямбда имеет 60s timeout, поэтому делаем максимум 5 страниц по 1000 (≈5000 товаров).
// Если каталог больше — следующий cron-тик подхватит next-offset из app_settings.
router.get(
  '/refresh-stocks',
  asyncHandler(async (req, res) => {
    if (!verifyCron(req)) return res.status(401).send();
    const token = await getMoyskladToken();
    if (!token) return res.status(503).json({ error: 'МС не настроен' });

    const MAX_PAGES = 5;
    const LIMIT = 1000;
    let pagesProcessed = 0;
    let totalUpdated = 0;
    let clearedMissing = 0;

    // Если предыдущий cron не закончил — продолжаем с сохранённого offset.
    const stateRow = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.cron_offset'`).catch(() => null);
    let offset = Number(stateRow?.value) || 0;

    // Фиксируем started_at для последующего обнуления отсутствующих (как в ручном импорте).
    if (offset === 0) {
      const nowIso = new Date().toISOString();
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('moysklad.stock_sync_started_at', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(nowIso),
      );
    }

    for (let i = 0; i < MAX_PAGES; i += 1) {
      let page;
      try {
        page = await fetchMoyskladStockByStorePage(token, offset, LIMIT);
      } catch (e) {
        console.error('[cron] МС-страница не загрузилась:', e.message);
        break;
      }
      const { byId, bySku, size, fetched } = page;

      if (byId.size || bySku.size) {
        await db.withTransaction(async (tx) => {
          if (byId.size) {
            const ids = [...byId.keys()];
            const jsons = ids.map((k) => JSON.stringify(byId.get(k)));
            const r = await tx.run(
              `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
               FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
               WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
              ids,
              jsons,
            );
            totalUpdated += r.changes || 0;
          }
          if (bySku.size) {
            const skus = [...bySku.keys()];
            const jsons = skus.map((s) => JSON.stringify(bySku.get(s)));
            const r = await tx.run(
              `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
               FROM unnest(?::text[], ?::jsonb[]) AS d(sku, sbs)
               WHERE p.external_source = 'moysklad' AND p.sku = d.sku AND p.stock_by_store IS NULL`,
              skus,
              jsons,
            );
            totalUpdated += r.changes || 0;
          }
        });
      }
      pagesProcessed += 1;

      const nextOffset = offset + fetched;
      const isLastPage = fetched < LIMIT || nextOffset >= size;

      if (isLastPage) {
        // Полный цикл прошёл — обнуляем у тех, кого МС не вернул, сбрасываем state.
        const startedRow = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.stock_sync_started_at'`).catch(() => null);
        const startedAt = startedRow?.value;
        if (startedAt) {
          const r = await db.run(
            `UPDATE products SET stock_by_store = NULL, updated_at = NOW()
             WHERE external_source = 'moysklad'
               AND stock_by_store IS NOT NULL
               AND updated_at < ?::timestamptz
               AND is_markdown IS NOT TRUE`,
            startedAt,
          );
          clearedMissing = r.changes || 0;
        }
        await db.run(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('moysklad.cron_offset', '0'::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = '0'::jsonb, updated_at = NOW()`,
        );
        offset = 0;
        break;
      }
      offset = nextOffset;
    }

    // Сохраняем offset для следующего тика, если цикл не дошёл до конца.
    if (offset > 0) {
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('moysklad.cron_offset', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(offset),
      );
    }

    res.json({
      ok: true,
      pagesProcessed,
      totalUpdated,
      clearedMissing,
      nextOffset: offset,
    });
  }),
);

// Auto-резервирование заказов «Ожидает товара»: проверяет наличие и резервирует.
// Дёргается Vercel Cron несколько раз в день (см. vercel.json).
router.get(
  '/auto-reserve-waiting',
  asyncHandler(async (req, res) => {
    if (!verifyCron(req)) return res.status(401).send();
    const utcHour = new Date().getUTCHours();
    // МСК = UTC+3. Пропускаем ночь (22:00-05:00 МСК = 19:00-02:00 UTC).
    if (utcHour < 2 || utcHour >= 19) {
      return res.json({ ok: true, skipped: 'night', utcHour });
    }

    const orders = await db.all(
      `SELECT * FROM orders WHERE status = 'waiting_stock' AND warehouse IS NOT NULL AND warehouse != ''`,
    );
    const reserved = [];
    const skipped = [];

    for (const order of orders) {
      const items = await db.all(
        `SELECT oi.id, oi.name, oi.quantity, oi.product_id, p.stock_by_store
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`,
        order.id,
      );
      const wh = order.warehouse.trim();
      let canReserve = true;
      for (const it of items) {
        if (!it.product_id) continue;
        const sbs = Array.isArray(it.stock_by_store) ? it.stock_by_store
          : (typeof it.stock_by_store === 'string' ? JSON.parse(it.stock_by_store || '[]') : []);
        const row = sbs.find((e) => String(e.store || '').trim() === wh);
        const stock = Number(row?.stock) || 0;
        const reserve = Number(row?.reserve) || 0;
        if (it.quantity > Math.max(0, stock - reserve)) { canReserve = false; break; }
      }
      if (!canReserve) { skipped.push(order.id); continue; }

      await db.withTransaction(async (tx) => {
        await tx.run(
          `UPDATE orders SET status = 'reserved', reserved_at = NOW(), updated_at = NOW() WHERE id = ?`,
          order.id,
        );
        const existing = await tx.get(`SELECT id FROM payments WHERE order_id = ? AND kind = 'income'`, order.id);
        if (!existing && (order.total_amount || 0) > 0) {
          await tx.run(
            `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, project_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'income', 'pending', ?, ?, NOW(), NOW())`,
            order.manager_id, order.id, order.total_amount, order.currency || 'RUB',
            `Заказ #${order.id}${order.marketplace ? ' · ' + order.marketplace : ''}`,
            order.project_id ?? null,
          );
        }
      });
      try { await applyLocalStockReserveDelta(order.id, 0, +1); } catch { /* ignore */ }
      await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'full' });
      reserved.push(order.id);
    }

    res.json({ ok: true, reserved, skipped });
  }),
);

export default router;
