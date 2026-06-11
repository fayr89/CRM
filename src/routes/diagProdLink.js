// TEMP: диагностика и настройка связей МС для производства. Удалить после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { decryptSecret } from '../services/secrets.js';
import { msFetchStores, msCreate, msHref } from '../services/moysklad.js';

const router = Router();
const SECRET = '4f8c9e2b5a1d6e3f8c9e2b5a1d6e3f8c';

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

async function getOrganizationId() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.organization_id'`).catch(() => null);
  return row?.value || null;
}

async function getInternalWarehouse() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
  return row?.value || null;
}

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

// Оприходование (entity/enter) на склад production.internal_warehouse в МС.
// Это «приход» — увеличивает остаток конкретной номенклатуры на складе.
// Параметры:
//   type=material&id=N  — оприходовать материал (из таблицы materials)
//   type=product&id=N   — оприходовать товар (из таблицы products)
//   qty=N               — сколько штук
//   price=P             — цена прихода (опционально; default 0)
// После создания документа для product дополнительно увеличиваем
// locally stock_by_store у этого склада, чтобы не ждать импорта остатков.
router.get(
  '/enter-stock',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const type = req.query.type === 'product' ? 'product' : 'material';
    const id = Number(req.query.id);
    const qty = Number(req.query.qty);
    const price = Number(req.query.price) || 0;
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id required (number)' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'qty required (positive number)' });

    const token = await getMsToken();
    if (!token) return res.status(503).json({ error: 'no MC token' });
    const orgId = await getOrganizationId();
    if (!orgId) return res.status(503).json({ error: 'moysklad.organization_id не настроен (сделайте «Инициализация МС» в Настройках)' });
    const wh = await getInternalWarehouse();
    if (!wh?.id) return res.status(503).json({ error: 'internal_warehouse не установлен' });

    let msId = null;
    let name = null;
    if (type === 'material') {
      const m = await db.get('SELECT id, name, ms_id FROM materials WHERE id = ?', id);
      if (!m) return res.status(404).json({ error: 'material not found' });
      msId = m.ms_id;
      name = m.name;
      if (!msId) return res.status(400).json({ error: 'у материала нет ms_id — сначала «Синхронизировать с МС» в карточке' });
    } else {
      const p = await db.get('SELECT id, name, external_id, external_source FROM products WHERE id = ?', id);
      if (!p) return res.status(404).json({ error: 'product not found' });
      msId = p.external_source === 'moysklad' ? p.external_id : null;
      name = p.name;
      if (!msId) return res.status(400).json({ error: 'у товара нет ms_id (external_id) — нужно импортировать из МС или создать карточку в МС' });
    }

    const body = {
      organization: { meta: { href: msHref('organization', orgId), type: 'organization', mediaType: 'application/json' } },
      store: { meta: { href: msHref('store', wh.id), type: 'store', mediaType: 'application/json' } },
      moment: new Date().toISOString().slice(0, 19).replace('T', ' '),
      description: `Оприходование из CRM: ${type} ${name} × ${qty}`,
      positions: [{
        assortment: { meta: { href: msHref('product', msId), type: 'product', mediaType: 'application/json' } },
        quantity: qty,
        price: Math.round(price * 100),
      }],
    };
    let created;
    try {
      created = await msCreate(token, 'enter', body);
    } catch (e) {
      return res.status(502).json({ error: 'МС: ' + e.message });
    }

    // Для product — обновляем локальный stock_by_store, чтобы CRM сразу видел приход.
    let localUpdated = false;
    if (type === 'product') {
      const p = await db.get('SELECT stock_by_store FROM products WHERE id = ?', id);
      let sbs = Array.isArray(p?.stock_by_store) ? [...p.stock_by_store]
        : (typeof p?.stock_by_store === 'string' ? JSON.parse(p.stock_by_store || '[]') : []);
      const idx = sbs.findIndex((s) => String(s.store || '').trim() === wh.name);
      if (idx >= 0) {
        sbs[idx] = { ...sbs[idx], stock: Number(sbs[idx].stock || 0) + qty };
      } else {
        sbs.push({ store: wh.name, stock: qty, reserve: 0 });
      }
      await db.run(
        `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
        JSON.stringify(sbs), id,
      ).catch(() => { /* ignore */ });
      localUpdated = true;
    }

    res.json({
      ok: true,
      ms_document: { id: created.id, name: created.name },
      type, id, name, qty, price,
      warehouse: wh,
      local_stock_updated: localUpdated,
    });
  }),
);

export default router;
