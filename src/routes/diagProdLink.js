// TEMP: диагностика и настройка связей МС для производства. Удалить после.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
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
    if (!orgId) return res.status(503).json({ error: 'moysklad.organization_id не настроен' });
    const wh = await getInternalWarehouse();
    if (!wh?.id) return res.status(503).json({ error: 'internal_warehouse не установлен' });

    let msId = null;
    let name = null;
    if (type === 'material') {
      const m = await db.get('SELECT id, name, ms_id FROM materials WHERE id = ?', id);
      if (!m) return res.status(404).json({ error: 'material not found' });
      msId = m.ms_id;
      name = m.name;
      if (!msId) return res.status(400).json({ error: 'у материала нет ms_id' });
    } else {
      const p = await db.get('SELECT id, name, external_id, external_source FROM products WHERE id = ?', id);
      if (!p) return res.status(404).json({ error: 'product not found' });
      msId = p.external_source === 'moysklad' ? p.external_id : null;
      name = p.name;
      if (!msId) return res.status(400).json({ error: 'у товара нет ms_id' });
    }

    const body = {
      organization: { meta: { href: msHref('organization', orgId), type: 'organization', mediaType: 'application/json' } },
      store: { meta: { href: msHref('store', wh.id), type: 'store', mediaType: 'application/json' } },
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
    res.json({ ok: true, ms_document: { id: created.id }, type, id, name, qty });
  }),
);

router.get(
  '/migrate-conv',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    await db.run(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS unit_purchase TEXT`);
    await db.run(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS purchase_to_unit_factor REAL`);
    res.json({ ok: true, added: ['unit_purchase', 'purchase_to_unit_factor'] });
  }),
);

// Upsert пользователя с ролью (по умолчанию director_prod — полный доступ
// к производственному модулю: материалы, техкарты, производственные заказы,
// подряды, P&L, настройки производства, оприходование).
// Параметры:
//   email, password — обязательно
//   name           — опционально (default «Директор производства»)
//   role           — опционально (default «director_prod»)
router.get(
  '/upsert-user',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const email = req.query.email ? String(req.query.email).trim().toLowerCase() : null;
    const password = req.query.password ? String(req.query.password) : null;
    const name = req.query.name ? String(req.query.name).trim() : 'Директор производства';
    const role = req.query.role ? String(req.query.role).trim() : 'director_prod';
    if (!email || !password) return res.status(400).json({ error: 'email, password required' });

    const hash = bcrypt.hashSync(password, 10);
    const existing = await db.get('SELECT id, email, role FROM users WHERE email = ?', email);
    if (existing) {
      await db.run(
        `UPDATE users SET password_hash = ?, role = ?, name = ?, active = TRUE, updated_at = NOW() WHERE id = ?`,
        hash, role, name, existing.id,
      );
      return res.json({ ok: true, action: 'updated', user: { id: existing.id, email, role, name } });
    }
    const r = await db.run(
      `INSERT INTO users (email, password_hash, name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, NOW(), NOW()) RETURNING id`,
      email, hash, name, role,
    );
    res.json({ ok: true, action: 'created', user: { id: r.lastInsertRowid, email, role, name } });
  }),
);

// Заказы, пострадавшие от глобального Avito-алиаса (2026-06-11, ~05:05-06:00 UTC):
// body.marketplace='Avito' при создании заказа подменялся на «Общий прайс».
// «Общий прайс» — никогда не валидная площадка заказа, так что любой такой
// заказ — жертва бага. ?fix=1 переименовывает обратно в Avito.
router.get(
  '/fix-avito-orders',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const affected = await db.all(
      `SELECT id, marketplace, client_name, status, created_at
       FROM orders WHERE marketplace = 'Общий прайс' ORDER BY id`,
    );
    if (req.query.fix === '1' && affected.length) {
      await db.run(`UPDATE orders SET marketplace = 'Avito', updated_at = NOW() WHERE marketplace = 'Общий прайс'`);
    }
    res.json({ ok: true, count: affected.length, fixed: req.query.fix === '1' && affected.length > 0, affected });
  }),
);

export default router;
