import { Router } from 'express';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// Аналитика только для админов и менеджеров.
router.use(authenticate, requireRole('admin', 'manager'));

function parseDays(query, def = 30) {
  return Math.min(365, Math.max(1, Number(query.days) || def));
}

// Выручка по дням за последние N дней (завершённые заказы).
router.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 30);
    const rows = await db.all(
      `SELECT
         DATE(completed_at) AS date,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(total_amount), 0)::float AS revenue
       FROM orders
       WHERE status = 'completed'
         AND completed_at > NOW() - (? || ' days')::interval
       GROUP BY DATE(completed_at)
       ORDER BY date`,
      String(days),
    );
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalOrders = rows.reduce((s, r) => s + r.orders_count, 0);
    res.json({
      period_days: days,
      points: rows,
      totals: {
        revenue: totalRevenue,
        orders: totalOrders,
        avg_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      },
    });
  }),
);

// Топ менеджеров по выручке и количеству сделок.
router.get(
  '/managers',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 90);
    const rows = await db.all(
      `SELECT
         u.id, u.name, u.role,
         COALESCE(SUM(o.total_amount), 0)::float AS revenue,
         COUNT(o.id)::int AS orders_count,
         COALESCE((
           SELECT COUNT(*)::int FROM deals d
           WHERE d.owner_id = u.id AND d.stage = 'won'
             AND d.closed_at > NOW() - (? || ' days')::interval
         ), 0) AS deals_won,
         COALESCE((
           SELECT SUM(amount)::float FROM deals d
           WHERE d.owner_id = u.id AND d.stage = 'won'
             AND d.closed_at > NOW() - (? || ' days')::interval
         ), 0) AS deals_revenue
       FROM users u
       LEFT JOIN orders o ON o.manager_id = u.id
         AND o.status = 'completed'
         AND o.completed_at > NOW() - (? || ' days')::interval
       WHERE u.role IN ('manager','sales','admin') AND u.active = TRUE
       GROUP BY u.id, u.name, u.role
       ORDER BY revenue DESC, deals_revenue DESC
       LIMIT 20`,
      String(days),
      String(days),
      String(days),
    );
    res.json({ period_days: days, data: rows });
  }),
);

// Выручка по площадкам.
router.get(
  '/marketplaces',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 90);
    const rows = await db.all(
      `SELECT
         COALESCE(marketplace, 'Не указана') AS marketplace,
         COUNT(*)::int AS orders_count,
         COALESCE(SUM(total_amount), 0)::float AS revenue,
         COALESCE(AVG(total_amount), 0)::float AS avg_order_value
       FROM orders
       WHERE status = 'completed'
         AND completed_at > NOW() - (? || ' days')::interval
       GROUP BY marketplace
       ORDER BY revenue DESC`,
      String(days),
    );
    res.json({ period_days: days, data: rows });
  }),
);

// Топ товаров с прибылью (цена − себестоимость).
router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 90);
    const rows = await db.all(
      `SELECT
         p.id, p.sku, p.name, p.image_url, p.cost_price,
         SUM(oi.quantity)::int AS units_sold,
         COALESCE(SUM(COALESCE(pp.price, oi.catalog_price, oi.unit_price) * oi.quantity), 0)::float AS revenue,
         COALESCE(SUM((COALESCE(pp.price, oi.catalog_price, oi.unit_price) - p.cost_price) * oi.quantity), 0)::float AS profit
       FROM products p
       JOIN order_items oi ON oi.product_id = p.id
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN product_prices pp ON pp.product_id = p.id
         AND pp.marketplace = o.marketplace
         AND pp.warehouse = COALESCE(o.warehouse, '')
       WHERE o.status = 'completed'
         AND o.completed_at > NOW() - (? || ' days')::interval
       GROUP BY p.id, p.sku, p.name, p.image_url, p.cost_price
       ORDER BY revenue DESC
       LIMIT 20`,
      String(days),
    );
    res.json({ period_days: days, data: rows });
  }),
);

// Конверсия воронки лидов: какая доля лидов в каком статусе.
router.get(
  '/funnel',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 90);
    const leads = await db.all(
      `SELECT status, COUNT(*)::int AS count
       FROM leads
       WHERE created_at > NOW() - (? || ' days')::interval
       GROUP BY status`,
      String(days),
    );
    const deals = await db.all(
      `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS amount
       FROM deals
       WHERE created_at > NOW() - (? || ' days')::interval
       GROUP BY stage`,
      String(days),
    );
    res.json({ period_days: days, leads, deals });
  }),
);

// Сводка всей аналитики для дашборда руководства за выбранный период.
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 30);
    const interval = `${days} days`;
    const [revenue, orders, deals, customers] = await Promise.all([
      db.get(
        `SELECT
           COALESCE(SUM(total_amount), 0)::float AS revenue,
           COUNT(*)::int AS orders
         FROM orders
         WHERE status = 'completed'
           AND completed_at > NOW() - INTERVAL '${interval}'`,
      ),
      db.get(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'new')::int AS new_orders,
           COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved_orders,
           COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped_orders
         FROM orders
         WHERE created_at > NOW() - INTERVAL '${interval}'`,
      ),
      db.get(
        `SELECT
           COUNT(*) FILTER (WHERE stage = 'won')::int AS won,
           COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost,
           COALESCE(SUM(amount) FILTER (WHERE stage = 'won'), 0)::float AS won_amount,
           COUNT(*) FILTER (WHERE stage NOT IN ('won','lost'))::int AS open
         FROM deals
         WHERE created_at > NOW() - INTERVAL '${interval}'`,
      ),
      db.get(
        `SELECT
           (SELECT COUNT(*)::int FROM leads WHERE created_at > NOW() - INTERVAL '${interval}') AS new_leads,
           (SELECT COUNT(*)::int FROM contacts WHERE created_at > NOW() - INTERVAL '${interval}') AS new_contacts,
           (SELECT COUNT(*)::int FROM companies WHERE created_at > NOW() - INTERVAL '${interval}') AS new_companies`,
      ),
    ]);
    const winRate = deals.won + deals.lost > 0 ? deals.won / (deals.won + deals.lost) : 0;
    res.json({
      period_days: days,
      revenue: {
        total: revenue.revenue,
        completed_orders: revenue.orders,
        avg_order_value: revenue.orders > 0 ? revenue.revenue / revenue.orders : 0,
      },
      orders,
      deals: { ...deals, win_rate: Number(winRate.toFixed(4)) },
      customers,
    });
  }),
);

export default router;
