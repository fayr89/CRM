// Cron-эндпоинты, дёргаются автоматически Vercel Cron (см. vercel.json crons).
// Авторизация: Vercel при наличии env CRON_SECRET сам добавит заголовок
// Authorization: Bearer ${CRON_SECRET}. Если env не задана — endpoint открытый
// (только лишние МС-запросы при злоупотреблении).
//
// ВНИМАНИЕ: в бэклоге было прямое указание «НЕ включать fail-fast раньше, чем
// заданы env (уронит прод)». Прод сейчас работает БЕЗ заданного CRON_SECRET,
// поэтому fail-fast возвращён к мягкому warning, как было до этого. Когда
// вы зададите CRON_SECRET в Vercel env, можно вернуть проверку.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { decryptSecret } from '../services/secrets.js';
import { msFetchStockByProductIds, fetchMoyskladStockByStorePage } from '../services/moysklad.js';
import { applyLocalStockReserveDelta } from '../services/ms-orders.js';
import { enqueueMsJob } from '../services/ms-jobs.js';
import { notify } from '../services/notifications.js';

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

// Keep-alive пинг БД: Supabase паузит проект после длительной неактивности
// (особенно ночью, когда auto-reserve-waiting выключен с 22:00 МСК). Ловили
// такой инцидент 2026-08-05 в 04:45 МСК — БД усыпилась, все /api/* вернули
// 500 «Failed to connect: :timeout». Этот cron гоняется каждые 5 мин 24/7
// и делает копеечный SELECT 1 — БД всегда «тёплая».
router.get(
  '/ping-db',
  asyncHandler(async (req, res) => {
    if (!verifyCron(req)) return res.status(401).send();
    const started = Date.now();
    try {
      const row = await db.get(`SELECT 1 AS ok, NOW() AS now_at`);
      res.json({ ok: true, elapsed_ms: Date.now() - started, now_at: row?.now_at });
    } catch (e) {
      res.status(503).json({
        ok: false,
        error: e.message,
        code: e.code,
        elapsed_ms: Date.now() - started,
      });
    }
  }),
);

async function getMoyskladToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  if (row?.value) {
    try { return decryptSecret(row.value); } catch { /* ignore */ }
  }
  return process.env.MOYSKLAD_TOKEN || null;
}

// Auto-импорт остатков по складам. Vercel Cron дёргает каждые 15 мин (см. vercel.json).
//
// История: раньше использовали общий МС-отчёт /report/stock/bystore без
// filter=. В инциденте 2026-06-12 он начал стабильно валить 504 — даже на
// первой странице limit=100 запрос к МС висит дольше 60с. Switched на
// per-UUID путь (msFetchStockByProductIds), он надёжный и работает с
// concurrency=1 (см. moysklad.js: ; в filter ломает мульти-UUID).
//
// Бюджет: ~500мс на UUID → 100 товаров за ~50с, помещается в 60s.
// Полный обход 4255 товаров займёт ~43 тика × 15мин = ~10 часов. Это
// больше чем хотелось бы, но как «фоновая подстраховка» сойдёт; критичное
// обновление перед резервом делает refreshProductStocks per-order.
router.get(
  '/refresh-stocks',
  asyncHandler(async (req, res) => {
    if (!verifyCron(req)) return res.status(401).send();
    const token = await getMoyskladToken();
    if (!token) return res.status(503).json({ error: 'МС не настроен' });

    const PAGE = 20;
    const DEADLINE_MS = 45_000;
    const startMs = Date.now();
    let totalUpdated = 0;
    let clearedMissing = 0;

    const stateRow = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.cron_offset'`).catch(() => null);
    let offset = Number(stateRow?.value) || 0;

    if (offset === 0) {
      const nowIso = new Date().toISOString();
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('moysklad.stock_sync_started_at', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(nowIso),
      );
    }

    const totalRow = await db.get(
      `SELECT COUNT(*)::int AS total FROM products
       WHERE external_source = 'moysklad' AND external_id IS NOT NULL
         AND is_markdown IS NOT TRUE AND active = TRUE`,
    );
    const total = totalRow?.total || 0;

    let done = false;
    while (true) {
      if (Date.now() - startMs > DEADLINE_MS) break;
      const products = await db.all(
        `SELECT id, external_id FROM products
         WHERE external_source = 'moysklad' AND external_id IS NOT NULL
           AND is_markdown IS NOT TRUE AND active = TRUE
         ORDER BY id LIMIT ? OFFSET ?`,
        PAGE, offset,
      );
      if (!products.length) { done = true; break; }

      const ids = products.map((p) => p.external_id);
      let byId;
      try {
        byId = await msFetchStockByProductIds(token, ids);
      } catch (e) {
        console.error('[cron] msFetchStockByProductIds:', e?.message);
        break;
      }

      const present = [];
      const presentJson = [];
      for (const p of products) {
        const sbs = byId.get(p.external_id);
        if (sbs && sbs.length) {
          present.push(p.external_id);
          presentJson.push(JSON.stringify(sbs));
        }
      }
      if (present.length) {
        const r = await db.run(
          `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
           FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
           WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
          present, presentJson,
        );
        totalUpdated += r.changes || 0;
      }

      offset += products.length;
      if (offset >= total) { done = true; break; }
    }

    if (done) {
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
    } else {
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('moysklad.cron_offset', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(offset),
      );
    }

    res.json({
      ok: true,
      totalUpdated,
      clearedMissing,
      nextOffset: offset,
      done,
      elapsed_ms: Date.now() - startMs,
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
      // Audit-лог: в #199 было видно что cron auto-reserve не писал в лог → в расследовании
      // истории резерва видно было только ручные действия. Добавляем запись без user_id
      // (это системное действие), user_name=«cron» для отличия в интерфейсе.
      await db.run(
        `INSERT INTO audit_log (user_id, user_name, user_role, action, entity_type, entity_id, details, created_at)
         VALUES (NULL, 'cron', 'system', 'order.auto_reserved', 'order', ?, ?::jsonb, NOW())`,
        order.id,
        JSON.stringify({ warehouse: order.warehouse, from: 'auto_cron' }),
      ).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[cron auto-reserve] audit_log INSERT failed:', e?.message);
      });
      reserved.push(order.id);
    }

    res.json({ ok: true, reserved, skipped });
  }),
);

// ==================== СРАВНЕНИЕ ОСТАТКОВ ПО СКЛАДАМ (МойСклад diff) ====================
// Пуллит МС stock-by-store, сравнивает со снапшотом в stock_ms_snapshots.
// Для складов, у которых есть подписчики (user_stock_watches) — шлёт уведомления
// об изменениях (приход +N, списание −N). Обновляет снапшот.
// Ловит движения даже если кто-то провёл приход/списание руками прямо в МС.
router.get(
  '/stock-diff',
  asyncHandler(async (req, res) => {
    if (!verifyCron(req)) return res.status(401).send();
    const started = Date.now();

    // Ленивое создание таблицы снапшотов (на случай если основная миграция ещё не прошла).
    await db.run(`
      CREATE TABLE IF NOT EXISTS stock_ms_snapshots (
        warehouse TEXT NOT NULL,
        product_external_id TEXT NOT NULL,
        stock NUMERIC(14,3) NOT NULL DEFAULT 0,
        reserve NUMERIC(14,3) NOT NULL DEFAULT 0,
        snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (warehouse, product_external_id)
      )
    `);

    // 1. Найти склады с подписчиками.
    const watchRows = await db.all(
      `SELECT DISTINCT warehouse FROM user_stock_watches
       WHERE watch_ship = TRUE OR watch_receipt = TRUE`,
    ).catch(() => []);
    if (!watchRows.length) return res.json({ ok: true, no_subscribers: true, elapsed_ms: Date.now() - started });
    const watchedSet = new Set(watchRows.map((r) => r.warehouse));

    // 2. МС-токен.
    const token = await getMoyskladToken();
    if (!token) return res.status(500).json({ error: 'MoySklad token not configured' });

    // 3. Пуллим stock-by-store страницами. Строим current[warehouse][productExtId] = {stock, reserve}.
    const current = {};
    const LIMIT = 500;
    const MAX_PAGES = 40;
    for (let p = 0; p < MAX_PAGES; p++) {
      let page;
      try {
        page = await fetchMoyskladStockByStorePage(token, p * LIMIT, LIMIT);
      } catch (e) {
        console.error('[stock-diff] MS page fetch failed:', e.message);
        break;
      }
      const byId = page.byId || new Map();
      if (byId.size === 0) break;
      for (const [productExtId, stores] of byId) {
        for (const s of stores) {
          if (!watchedSet.has(s.store)) continue;
          (current[s.store] = current[s.store] || {})[productExtId] = { stock: s.stock, reserve: s.reserve };
        }
      }
      if (byId.size < LIMIT) break;
    }

    // 4. Читаем прошлый снапшот для подписанных складов.
    const whs = Array.from(watchedSet);
    const prevRows = await db.all(
      `SELECT warehouse, product_external_id, stock, reserve FROM stock_ms_snapshots WHERE warehouse = ANY(?)`,
      whs,
    );
    const prev = {};
    for (const r of prevRows) {
      (prev[r.warehouse] = prev[r.warehouse] || {})[r.product_external_id] = {
        stock: Number(r.stock), reserve: Number(r.reserve),
      };
    }

    // 5. Первый прогон (снапшот пустой) — только сохраняем, БЕЗ уведомлений
    // (иначе флуднём всеми текущими остатками как «приход»).
    const firstRun = prevRows.length === 0;

    // 6. Diff.
    const summary = { warehouses: {}, totals: { receipts: 0, ships: 0 } };
    if (!firstRun) {
      for (const wh of whs) {
        const cur = current[wh] || {};
        const old = prev[wh] || {};
        const receipts = [];
        const ships = [];
        const allIds = new Set([...Object.keys(cur), ...Object.keys(old)]);
        for (const id of allIds) {
          const c = cur[id]?.stock ?? 0;
          const o = old[id]?.stock ?? 0;
          const d = c - o;
          if (d > 0.001) receipts.push({ id, delta: d, current: c });
          else if (d < -0.001) ships.push({ id, delta: -d, current: c });
        }
        if (receipts.length || ships.length) {
          summary.warehouses[wh] = { receipts, ships };
          summary.totals.receipts += receipts.length;
          summary.totals.ships += ships.length;
        }
      }

      // 7. Резолвим external_id → название товара.
      const allIds = new Set();
      for (const wh of Object.keys(summary.warehouses)) {
        for (const r of summary.warehouses[wh].receipts) allIds.add(r.id);
        for (const s of summary.warehouses[wh].ships) allIds.add(s.id);
      }
      const idToName = new Map();
      if (allIds.size) {
        const prods = await db.all(
          `SELECT external_id, name FROM products WHERE external_id = ANY(?)`,
          Array.from(allIds),
        );
        for (const p of prods) idToName.set(p.external_id, p.name);
      }

      // 8. Уведомления подписчикам (одно на склад).
      for (const wh of Object.keys(summary.warehouses)) {
        const { receipts, ships } = summary.warehouses[wh];
        const subs = await db.all(
          `SELECT u.id AS uid, w.watch_ship, w.watch_receipt
           FROM user_stock_watches w
           JOIN users u ON u.id = w.user_id AND u.active = TRUE
           WHERE w.warehouse = ?`,
          wh,
        );
        for (const s of subs) {
          const parts = [];
          if (s.watch_receipt && receipts.length) {
            const preview = receipts.slice(0, 5).map((r) =>
              `+${r.delta.toFixed(2)} · ${(idToName.get(r.id) || r.id.slice(0, 8) + '…')}`
            ).join('\n');
            parts.push(`📥 Приход (${receipts.length}):\n${preview}${receipts.length > 5 ? '\n…' : ''}`);
          }
          if (s.watch_ship && ships.length) {
            const preview = ships.slice(0, 5).map((x) =>
              `−${x.delta.toFixed(2)} · ${(idToName.get(x.id) || x.id.slice(0, 8) + '…')}`
            ).join('\n');
            parts.push(`🚚 Списание (${ships.length}):\n${preview}${ships.length > 5 ? '\n…' : ''}`);
          }
          if (parts.length) {
            await notify(
              s.uid, 'stock.ms_diff',
              `📊 Движения на складе: ${wh}`,
              parts.join('\n\n'),
              '#/products',
            ).catch(() => {});
          }
        }
      }
    }

    // 9. Обновляем снапшот (upsert текущих значений).
    const upsertPairs = [];
    for (const wh of whs) {
      const cur = current[wh] || {};
      for (const [id, s] of Object.entries(cur)) {
        upsertPairs.push([wh, id, s.stock, s.reserve]);
      }
    }
    // Батч-INSERT по 200 записей.
    const BATCH = 200;
    for (let i = 0; i < upsertPairs.length; i += BATCH) {
      const chunk = upsertPairs.slice(i, i + BATCH);
      const values = chunk.map(() => `(?, ?, ?, ?, NOW())`).join(', ');
      const params = [];
      for (const [wh, id, st, rv] of chunk) params.push(wh, id, st, rv);
      await db.run(
        `INSERT INTO stock_ms_snapshots (warehouse, product_external_id, stock, reserve, snapshot_at)
         VALUES ${values}
         ON CONFLICT (warehouse, product_external_id)
         DO UPDATE SET stock = EXCLUDED.stock, reserve = EXCLUDED.reserve, snapshot_at = NOW()`,
        ...params,
      );
    }

    res.json({
      ok: true,
      first_run: firstRun,
      warehouses_watched: whs.length,
      snapshot_rows_upserted: upsertPairs.length,
      movements: summary.totals,
      elapsed_ms: Date.now() - started,
    });
  }),
);

export default router;
