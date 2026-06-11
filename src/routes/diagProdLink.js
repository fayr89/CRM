// TEMP: диагностика и настройка связей МС для производства. Удалить после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { decryptSecret } from '../services/secrets.js';
import { msFetchStores } from '../services/moysklad.js';

const router = Router();
const SECRET = '4f8c9e2b5a1d6e3f8c9e2b5a1d6e3f8c';

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

// Список всех складов МС (без архивных).
router.get(
  '/ms-stores',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const t = await getMsToken();
    if (!t) return res.status(503).json({ error: 'no MC token' });
    const all = await msFetchStores(t);
    const stores = all.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name, archived: s.archived }));
    res.json({ count: stores.length, stores });
  }),
);

// Поиск склада в МС по подстроке (case-insensitive).
router.get(
  '/find-store',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const q = req.query.q ? String(req.query.q).trim().toLowerCase() : null;
    if (!q) return res.status(400).json({ error: 'q required' });
    const t = await getMsToken();
    if (!t) return res.status(503).json({ error: 'no MC token' });
    const all = await msFetchStores(t);
    const matches = all
      .filter((s) => !s.archived && (s.name || '').toLowerCase().includes(q))
      .map((s) => ({ id: s.id, name: s.name }));
    res.json({ q, count: matches.length, matches });
  }),
);

// Установить внутренний склад производства (app_settings.production.internal_warehouse).
// Этот склад будет использоваться как materialsStore + store в entity/processing МС
// (в productionOrders.js «Выполнили заказ N штук»).
router.get(
  '/set-prod-warehouse',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const storeId = req.query.store_id ? String(req.query.store_id).trim() : null;
    const storeName = req.query.store_name ? String(req.query.store_name).trim() : null;
    if (!storeId || !storeName) return res.status(400).json({ error: 'store_id, store_name required' });
    const payload = JSON.stringify({ id: storeId, name: storeName });
    await db.run(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('production.internal_warehouse', ?::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      payload,
    );
    res.json({ ok: true, set: { id: storeId, name: storeName } });
  }),
);

// Сводка связей производства:
//   — установленный internal_warehouse
//   — ставка труда
//   — товары без ms_id (не импортированы из МС) — их нельзя «Выполнить»
//   — материалы без ms_id — их нельзя списывать в entity/processing
//   — техкарты
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const whRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
    const rateRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
    const tokenRow = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
    const matStats = await db.get(
      `SELECT COUNT(*)::int AS total,
              COUNT(CASE WHEN ms_id IS NOT NULL AND ms_id <> '' THEN 1 END)::int AS with_ms_id,
              COUNT(CASE WHEN ms_sync_error IS NOT NULL THEN 1 END)::int AS with_errors
       FROM materials WHERE active = TRUE`,
    );
    const planStats = await db.get(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT product_id)::int AS products_with_plan
       FROM processing_plans WHERE active = TRUE`,
    );
    const matErrors = await db.all(
      `SELECT id, name, sku, ms_sync_error FROM materials
       WHERE active = TRUE AND ms_sync_error IS NOT NULL LIMIT 20`,
    );
    const matNoMs = await db.all(
      `SELECT id, name, sku FROM materials
       WHERE active = TRUE AND (ms_id IS NULL OR ms_id = '') LIMIT 20`,
    );
    // Товары в техкартах без ms_id (наши товары без внешнего ID МС).
    const prodNoMs = await db.all(
      `SELECT p.id, p.name, p.sku FROM products p
       JOIN processing_plans pp ON pp.product_id = p.id
       WHERE pp.active = TRUE AND (p.external_source IS NULL OR p.external_id IS NULL)
       LIMIT 20`,
    );
    res.json({
      internal_warehouse: whRow?.value || null,
      labor_rate_per_minute: rateRow?.value || null,
      ms_token_configured: !!tokenRow?.value,
      materials: {
        total: matStats?.total || 0,
        with_ms_id: matStats?.with_ms_id || 0,
        with_errors: matStats?.with_errors || 0,
        sample_no_ms: matNoMs,
        sample_errors: matErrors,
      },
      products_in_plans_without_ms_id: prodNoMs,
      processing_plans: {
        total: planStats?.total || 0,
        products_with_plan: planStats?.products_with_plan || 0,
      },
    });
  }),
);

export default router;
