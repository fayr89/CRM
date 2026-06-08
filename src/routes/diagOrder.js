// TEMP: разовая диагностика заказа #199 + очистка зависших резервов. Удалить после.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '4f8c9e2b5a1d6e3f8c9e2b5a1d6e3f8c';

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

// Очистка зависших резервов: пересчитывает stock_by_store[].reserve у всех
// товаров исходя из РЕАЛЬНО зарезервированных заказов (status='reserved').
// Призрачные резервы (от заказов в waiting_stock/new/cancelled) обнуляются.
// ?dryRun=true показывает что собирается изменить, ничего не пишет.
// ?sku=XXX ограничивает обработку одним товаром (быстро).
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

export default router;
