// TEMP: разовая диагностика заказа #199 + очистка зависших резервов. Удалить после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();
const SECRET = '4f8c9e2b5a1d6e3f8c9e2b5a1d6e3f8c';

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

router.get(
  '/order',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const id = Number(req.query.id || 199);
    const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
    if (!order) return res.status(404).json({ error: 'order not found' });
    const items = await db.all(
      `SELECT oi.id, oi.product_id, oi.name, oi.sku, oi.quantity,
              p.stock_by_store, p.stock
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      id,
    );
    const audit = await db.all(
      `SELECT id, user_id, user_name, user_role, action, details, created_at
       FROM audit_log WHERE entity_type='order' AND entity_id=?
       ORDER BY created_at ASC`,
      id,
    );
    const msJobs = await db.all(
      `SELECT id, action, status, attempts, last_error, ms_document_id,
              scheduled_at, created_at, updated_at
       FROM ms_jobs WHERE order_id=? ORDER BY created_at ASC`,
      id,
    );
    const payments = await db.all(
      `SELECT id, kind, status, amount, parent_payment_id, created_at
       FROM payments WHERE order_id=? ORDER BY created_at ASC`,
      id,
    );
    const wh = (order.warehouse || '').trim();
    const stockBreakdown = items.filter((i) => i.product_id).map((it) => {
      const sbs = Array.isArray(it.stock_by_store) ? it.stock_by_store
        : (typeof it.stock_by_store === 'string' ? JSON.parse(it.stock_by_store || '[]') : []);
      const inOrderWh = sbs.find((e) => String(e.store || '').trim() === wh) || null;
      return {
        product_id: it.product_id, name: it.name, sku: it.sku, order_qty: it.quantity,
        in_order_warehouse: inOrderWh,
        all_warehouses: sbs,
      };
    });
    res.json({
      order: {
        id: order.id, status: order.status, warehouse: order.warehouse,
        marketplace: order.marketplace, manager_id: order.manager_id,
        reserved_at: order.reserved_at, shipped_at: order.shipped_at,
        created_at: order.created_at, updated_at: order.updated_at,
        shipment_qr: order.shipment_qr, total_amount: order.total_amount,
      },
      items_count: items.length,
      stock_breakdown: stockBreakdown,
      audit_log: audit.map((a) => ({
        ts: a.created_at, user: a.user_name || `id=${a.user_id}`,
        role: a.user_role, action: a.action, details: a.details,
      })),
      ms_jobs: msJobs,
      payments,
    });
  }),
);

router.get(
  '/fix-reserves',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
    const onlySku = req.query.sku ? String(req.query.sku).trim() : null;
    const baseSql = `SELECT id, name, sku, stock_by_store FROM products
       WHERE stock_by_store IS NOT NULL AND active = TRUE`;
    const products = onlySku
      ? await db.all(`${baseSql} AND sku = ?`, onlySku)
      : await db.all(baseSql);
    const changes = [];
    let touched = 0;
    for (const p of products) {
      const sbs = Array.isArray(p.stock_by_store) ? p.stock_by_store
        : (typeof p.stock_by_store === 'string' ? JSON.parse(p.stock_by_store || '[]') : []);
      if (!sbs.length) continue;
      const reservedRows = await db.all(
        `SELECT o.warehouse AS wh, SUM(oi.quantity)::int AS qty
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = ? AND o.status = 'reserved'
           AND o.warehouse IS NOT NULL AND o.warehouse <> ''
         GROUP BY o.warehouse`,
        p.id,
      );
      const realByWh = Object.fromEntries(reservedRows.map((r) => [String(r.wh).trim(), Number(r.qty) || 0]));
      const diffs = [];
      const newSbs = sbs.map((row) => {
        const wh = String(row.store || '').trim();
        const real = realByWh[wh] || 0;
        const cur = Number(row.reserve || 0);
        if (cur !== real) {
          diffs.push({ store: wh, was: cur, now: real });
          return { ...row, reserve: real };
        }
        return row;
      });
      if (diffs.length) {
        if (!dryRun) {
          await db.run(
            `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
            JSON.stringify(newSbs), p.id,
          );
        }
        touched += 1;
        changes.push({ product_id: p.id, name: p.name, sku: p.sku, diffs });
      }
    }
    res.json({
      ok: true, dryRun, products_scanned: products.length, products_changed: touched,
      sample: changes.slice(0, 30), total_changes: changes.length,
    });
  }),
);

// Диагностика товара: что у нас в БД vs. что в МС /report/stock/bystore по
// этому товару (фильтр article или productid).
router.get(
  '/product',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const sku = req.query.sku ? String(req.query.sku).trim() : null;
    if (!sku) return res.status(400).json({ error: 'sku required' });
    const ours = await db.all(
      `SELECT id, sku, name, external_source, external_id, active, is_markdown,
              stock, stock_by_store, updated_at
       FROM products WHERE sku = ? OR sku = ?`,
      sku, sku.toUpperCase(),
    );
    const msToken = await getMsToken();
    let msStockByStore = null;
    let msSearchByArticle = null;
    let msError = null;
    if (msToken) {
      try {
        const headers = { Authorization: `Bearer ${msToken}`, 'Accept-Encoding': 'gzip' };
        const u1 = `https://api.moysklad.ru/api/remap/1.2/entity/product?filter=article=${encodeURIComponent(sku)}&limit=20`;
        const r1 = await fetch(u1, { headers });
        const j1 = r1.ok ? await r1.json() : null;
        msSearchByArticle = (j1?.rows || []).map((p) => ({
          id: p.id, name: p.name, code: p.code, article: p.article, archived: !!p.archived,
        }));
        const u2 = `https://api.moysklad.ru/api/remap/1.2/report/stock/bystore?filter=article=${encodeURIComponent(sku)}&limit=20`;
        const r2 = await fetch(u2, { headers });
        const j2 = r2.ok ? await r2.json() : null;
        msStockByStore = (j2?.rows || []).map((row) => ({
          name: row.name, code: row.code, article: row.article, uuid: row.meta?.href?.split('/').pop()?.split('?')[0],
          stockByStore: (row.stockByStore || []).map((s) => ({
            store: s.name, stock: Number(s.stock) || 0, reserve: Number(s.reserve) || 0,
            quantity: Number(s.quantity) || 0,
          })),
        }));
        if (!r1.ok) msError = `entity/product: ${r1.status} ${await r1.text().catch(() => '')}`;
        if (!r2.ok) msError = `${msError || ''} stock/bystore: ${r2.status} ${await r2.text().catch(() => '')}`.trim();
      } catch (e) {
        msError = String(e.message);
      }
    } else {
      msError = 'token not configured';
    }
    res.json({
      sku,
      ours_count: ours.length,
      ours: ours.map((o) => ({
        id: o.id, sku: o.sku, name: o.name,
        external_source: o.external_source, external_id: o.external_id,
        active: o.active, is_markdown: o.is_markdown,
        stock: o.stock,
        stock_by_store: Array.isArray(o.stock_by_store) ? o.stock_by_store
          : (typeof o.stock_by_store === 'string' ? JSON.parse(o.stock_by_store || '[]') : null),
        updated_at: o.updated_at,
      })),
      ms_error: msError,
      ms_products_by_article: msSearchByArticle,
      ms_stock_by_store: msStockByStore,
    });
  }),
);

export default router;
