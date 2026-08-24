// ВРЕМЕННЫЙ diag-endpoint: собрать все уникальные названия складов из БД.
// GET /api/diag/list-warehouses-v1?key=wh-list-2026-b7m3
// После использования — снести файл + маунт отдельным коммитом.

import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET_KEY = 'wh-list-2026-b7m3';

router.get(
  '/list-warehouses-v1',
  asyncHandler(async (req, res) => {
    if (req.query.key !== SECRET_KEY) return res.status(401).json({ error: 'bad key' });

    const collect = async (sql) => {
      try { return (await db.all(sql)).map((r) => r.name).filter(Boolean); } catch { return []; }
    };

    const fromOrders = await collect(
      `SELECT DISTINCT warehouse AS name FROM orders WHERE warehouse IS NOT NULL AND warehouse <> '' ORDER BY 1`,
    );
    const fromPrices = await collect(
      `SELECT DISTINCT warehouse AS name FROM product_prices WHERE warehouse IS NOT NULL AND warehouse <> '' ORDER BY 1`,
    );
    const fromMaterials = await collect(
      `SELECT DISTINCT warehouse AS name FROM materials WHERE warehouse IS NOT NULL AND warehouse <> '' ORDER BY 1`,
    ).catch(() => []);
    // app_settings — key='warehouses' (список от админа), production.internal_warehouse (внутр. склад).
    const settingsRows = await db.all(
      `SELECT key, value FROM app_settings WHERE key IN ('warehouses', 'production.internal_warehouse', 'warehouse_visibility')`,
    ).catch(() => []);
    const fromSettings = {};
    for (const s of settingsRows) fromSettings[s.key] = s.value;

    // Соединяем всё в один set + считаем частоту в orders.
    const all = new Set();
    for (const n of fromOrders) all.add(n);
    for (const n of fromPrices) all.add(n);
    for (const n of fromMaterials) all.add(n);
    // Извлекаем имена из settings (если это массив или объект).
    for (const [, v] of Object.entries(fromSettings)) {
      if (Array.isArray(v)) for (const x of v) { if (typeof x === 'string') all.add(x); else if (x?.name) all.add(x.name); }
      else if (typeof v === 'string') all.add(v);
      else if (v?.name) all.add(v.name);
    }

    // Частота по orders для сортировки «где реально работают».
    const freq = await db.all(
      `SELECT warehouse, COUNT(*)::int AS n FROM orders
       WHERE warehouse IS NOT NULL AND warehouse <> ''
       GROUP BY warehouse ORDER BY n DESC`,
    ).catch(() => []);
    const freqMap = Object.fromEntries(freq.map((r) => [r.warehouse, r.n]));

    // Финальный список.
    const list = Array.from(all).map((name) => ({
      name,
      orders_count: freqMap[name] || 0,
      in_prices: fromPrices.includes(name),
      in_materials: fromMaterials.includes(name),
    })).sort((a, b) => (b.orders_count - a.orders_count) || a.name.localeCompare(b.name, 'ru'));

    // Отдельно ищем совпадения по «Новосибирск» / «производство».
    const candidates = list.filter((w) =>
      /новосибирск|нск|производств/i.test(w.name),
    );

    res.json({
      total_unique: list.length,
      candidates_for_novosibirsk_prod: candidates,
      all_warehouses: list,
      settings_snapshot: fromSettings,
    });
  }),
);

export default router;
