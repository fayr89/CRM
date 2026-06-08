// TEMP: разовая диагностика заказа #199 (зависший резерв). Удалить после.
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
    // Сколько резерва висит на товарах заказа в указанном складе.
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

export default router;
