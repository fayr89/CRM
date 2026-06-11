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

const router = Router();
router.use(authenticate);

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

export default router;
