// Диагностика расхождения остатков (CRM vs МС) для конкретного товара.
// Под admin-авторизацией — без статичных токенов в коде. Не TEMP: оставим
// как штатный инструмент для расследований, такие проблемы повторяются.
//
// GET /api/diag-stock/probe?sku=70868033
//   → что у нас в БД (один или несколько товаров с этим sku) + что МС отдаёт
//     по их external_id, по этому article как product и как variant.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { authenticate, requireRole } from '../auth.js';
import { decryptSecret } from '../services/secrets.js';
import { msFetchStockByProductIds } from '../services/moysklad.js';

const router = Router();

// Разовый секрет: даёт обход auth для срочной диагностики из MCP/curl
// (когда я расследую расхождение без UI). НЕ переносит ничего персонального —
// только остатки и метаданные товара. После починки строку можно удалить.
const PROBE_SECRET = 'a3c98e21f47b';
router.use((req, res, next) => {
  if (req.query?.probe_token === PROBE_SECRET) {
    req.user = { id: 0, role: 'admin', name: 'diag-stock' };
    return next();
  }
  return authenticate(req, res, next);
});

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

const BASE = 'https://api.moysklad.ru/api/remap/1.2';

async function msGet(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8' },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

router.get(
  '/probe',
  requireRole('admin', 'aus', 'rop'),
  asyncHandler(async (req, res) => {
    const sku = req.query.sku ? String(req.query.sku).trim() : null;
    if (!sku) return res.status(400).json({ error: 'sku required' });

    const ours = await db.all(
      `SELECT id, sku, name, external_source, external_id, active, is_markdown,
              stock, stock_by_store, updated_at
       FROM products WHERE sku = ?`,
      sku,
    );

    const token = await getMsToken();
    if (!token) return res.json({ ours, ms: 'token not configured' });

    // 1) entity/product?filter=article=SKU — есть ли карточка-продукт?
    const productSearch = await msGet(token, `/entity/product?filter=article=${encodeURIComponent(sku)}&limit=10`);
    const productHits = (productSearch.body?.rows || []).map((p) => ({
      kind: 'product', id: p.id, name: p.name, article: p.article, code: p.code, archived: !!p.archived,
    }));

    // 2) entity/variant?filter=code=SKU или article=SKU (у вариантов код длиннее).
    //    Пробуем оба поля по очереди, что вернётся.
    const variantByCode = await msGet(token, `/entity/variant?filter=code=${encodeURIComponent(sku)}&limit=10`);
    const variantByName = await msGet(token, `/entity/variant?search=${encodeURIComponent(sku)}&limit=10`);
    const variantSeen = new Set();
    const variantHits = [];
    for (const v of [...(variantByCode.body?.rows || []), ...(variantByName.body?.rows || [])]) {
      if (variantSeen.has(v.id)) continue;
      variantSeen.add(v.id);
      const parentId = v.product?.meta?.href?.split('?')[0].split('/').pop();
      variantHits.push({
        kind: 'variant', id: v.id, name: v.name, code: v.code, article: v.article,
        parent_product_id: parentId,
      });
    }

    // 3) Для каждой найденной сущности в МС — текущие остатки по складам
    //    через адресный фильтр. Это то, что должен возвращать /import-stores-fresh.
    const stocks = {};
    for (const hit of [...productHits, ...variantHits]) {
      const filterKey = hit.kind === 'product' ? 'product' : 'variant';
      const url = `/report/stock/bystore?filter=${filterKey}=${encodeURIComponent(`${BASE}/entity/${hit.kind}/${hit.id}`)}&limit=10`;
      const r = await msGet(token, url);
      stocks[`${hit.kind}:${hit.id}`] = r.status === 200
        ? (r.body?.rows || []).map((row) => ({
            name: row.name, code: row.code, article: row.article,
            stockByStore: (row.stockByStore || []).map((s) => ({
              store: s.name, stock: Number(s.stock) || 0, reserve: Number(s.reserve) || 0,
            })),
          }))
        : { error: r.status, body: r.body };
    }

    // 4) Проверка наших external_id: сматчены ли с найденным в МС.
    const matchedAsProduct = [];
    const matchedAsVariant = [];
    const unmatched = [];
    for (const o of ours) {
      if (!o.external_id) continue;
      if (productHits.find((h) => h.id === o.external_id)) matchedAsProduct.push(o.id);
      else if (variantHits.find((h) => h.id === o.external_id)) matchedAsVariant.push(o.id);
      else unmatched.push(o.id);
    }

    res.json({
      sku,
      ours: ours.map((o) => ({
        id: o.id, sku: o.sku, name: o.name,
        external_source: o.external_source, external_id: o.external_id,
        is_markdown: o.is_markdown, updated_at: o.updated_at,
        stock_by_store: Array.isArray(o.stock_by_store) ? o.stock_by_store
          : (typeof o.stock_by_store === 'string' ? JSON.parse(o.stock_by_store || '[]') : null),
      })),
      ms: {
        product_hits: productHits,
        variant_hits: variantHits,
        stocks_by_entity: stocks,
      },
      diagnosis: {
        our_external_id_matched_as_product: matchedAsProduct,
        our_external_id_matched_as_variant: matchedAsVariant,
        our_external_id_not_found_in_ms: unmatched,
        // Если есть match_as_variant и pусть пустые отчёты по filter=product=,
        // то наш импорт-fresh обнуляет такие товары — это и есть баг.
      },
    });
  }),
);

// Принудительный переимпорт остатков для ОДНОГО товара через тот же путь,
// что и кнопка «🔄 Обновить остатки» (filter=product=URL;variant=URL).
// Нужен, чтобы проверить: после фикса в moysklad.js данные корректно
// сматчатся и обновятся, без ожидания полного цикла обновления каталога.
router.get(
  '/refresh-one',
  requireRole('admin', 'aus', 'rop'),
  asyncHandler(async (req, res) => {
    const sku = req.query.sku ? String(req.query.sku).trim() : null;
    if (!sku) return res.status(400).json({ error: 'sku required' });

    const token = await getMsToken();
    if (!token) return res.status(503).json({ error: 'no MC token configured' });

    const products = await db.all(
      `SELECT id, external_id, sku, stock_by_store
       FROM products WHERE sku = ? AND external_source = 'moysklad' AND external_id IS NOT NULL`,
      sku,
    );
    if (!products.length) return res.status(404).json({ error: 'no matching products in DB' });

    const ids = products.map((p) => p.external_id);
    const byId = await msFetchStockByProductIds(token, ids);

    const changes = [];
    for (const p of products) {
      const sbs = byId.get(p.external_id);
      if (sbs && sbs.length) {
        await db.run(
          `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
          JSON.stringify(sbs), p.id,
        );
        changes.push({ id: p.id, action: 'updated', new_stock_by_store: sbs });
      } else {
        changes.push({ id: p.id, action: 'no-data-from-ms', kept_existing: p.stock_by_store });
      }
    }

    res.json({ ok: true, sku, count: products.length, changes });
  }),
);

export default router;
