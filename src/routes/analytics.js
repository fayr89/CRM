import { Router } from 'express';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// Аналитика: админ/РОП/менеджер/склад/АУС. Каждый смотрит свои разрезы,
// но эндпоинты read-only, изоляция не нужна.
router.use(authenticate, requireRole('admin', 'manager', 'rop', 'warehouse', 'aus'));

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
         AND pp.marketplace = 'Общий прайс'
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

// Аналитика по остаткам склада: оборачиваемость, ABC/XYZ, dead-stock, дефицит,
// рекомендации. Всё за один запрос — фронт рендерит дашборд + топы + таблицу.
// Параметр ?days= влияет на окно расчёта продаж (по умолчанию 90 дней).
router.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query, 90);
    // 1) Продажи по товарам за N дней — учитываем shipped/completed (реальные отгрузки).
    //    cancelled и возвраты не учитываем — не искажаем оборачиваемость.
    //    Мэтч: сначала по order_items.product_id, если пусто — по sku.
    const salesRows = await db.all(
      `SELECT
         COALESCE(oi.product_id,
           (SELECT p.id FROM products p WHERE p.sku = oi.sku LIMIT 1)) AS product_id,
         SUM(oi.quantity)::float AS qty_sold,
         SUM(oi.quantity * COALESCE(oi.unit_price, 0))::float AS revenue,
         COUNT(DISTINCT o.id)::int AS order_count,
         MIN(o.created_at) AS first_sale,
         MAX(o.created_at) AS last_sale,
         COUNT(DISTINCT date_trunc('day', o.created_at))::int AS days_with_sales
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('shipped', 'completed')
         AND o.created_at >= NOW() - INTERVAL '${days} days'
       GROUP BY COALESCE(oi.product_id, (SELECT p.id FROM products p WHERE p.sku = oi.sku LIMIT 1))`,
    );
    const salesByPid = new Map(salesRows.filter((r) => r.product_id).map((r) => [r.product_id, r]));

    // 2) Все активные (не архив, не уценка) товары каталога.
    const products = await db.all(
      `SELECT id, sku, name, image_url, cost_price, stock, unit, external_source
       FROM products
       WHERE active = TRUE AND (is_markdown IS NULL OR is_markdown = FALSE)
       ORDER BY name`,
    );

    // 3) Обогащаем + рассчитываем метрики.
    const items = products.map((p) => {
      const s = salesByPid.get(p.id) || {};
      const qtySold = Number(s.qty_sold) || 0;
      const revenue = Number(s.revenue) || 0;
      const stock = Number(p.stock) || 0;
      const cost = Number(p.cost_price) || 0;
      const stockValue = stock * cost;
      const avgDaily = qtySold / days;
      // Дней остатка до нуля (при текущем темпе). Infinity — вообще не продаётся.
      const daysLeft = avgDaily > 0 ? stock / avgDaily : (stock > 0 ? null : 0);
      // Оборачиваемость (турновер, раз в год). qty_sold_year / (avg_stock ~ stock).
      const turnoverPerYear = stock > 0 ? (qtySold / days) * 365 / stock : (qtySold > 0 ? 999 : 0);
      // Статус по остатку + продажам.
      let status = 'normal';
      let statusText = 'Норма';
      if (qtySold === 0 && stock > 0) { status = 'dead'; statusText = 'Мёртвый сток (0 продаж)'; }
      else if (stock === 0 && qtySold > 0) { status = 'out'; statusText = 'Закончился'; }
      else if (daysLeft != null && daysLeft < 7 && avgDaily > 0) { status = 'urgent'; statusText = 'Скоро закончится (<7 дн)'; }
      else if (daysLeft != null && daysLeft < 14 && avgDaily > 0) { status = 'low'; statusText = 'Заканчивается (<14 дн)'; }
      else if (daysLeft != null && daysLeft > 180 && stock > 0) { status = 'excess'; statusText = 'Избыток (>180 дн)'; }
      else if (stock === 0 && qtySold === 0) { status = 'inactive'; statusText = 'Нет остатка, нет продаж'; }
      return {
        id: p.id, sku: p.sku, name: p.name, image_url: p.image_url,
        cost_price: cost, stock, unit: p.unit || 'шт', external_source: p.external_source,
        qty_sold: qtySold,
        revenue,
        order_count: Number(s.order_count) || 0,
        days_with_sales: Number(s.days_with_sales) || 0,
        last_sale: s.last_sale || null,
        stock_value: stockValue,
        avg_daily: avgDaily,
        days_left: daysLeft,
        turnover_per_year: turnoverPerYear,
        status, status_text: statusText,
      };
    });

    // 4) ABC-класcификация по выручке (80/95%). Только товары с продажами.
    const sortedByRev = [...items].filter((x) => x.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const totalRev = sortedByRev.reduce((s, x) => s + x.revenue, 0);
    let cum = 0;
    for (const it of sortedByRev) {
      cum += it.revenue;
      const share = totalRev > 0 ? cum / totalRev : 0;
      it.abc = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C';
    }
    // Товары без продаж в ABC не входят → они «мёртвый сток», отмечаем как D.
    for (const it of items) if (it.abc == null) it.abc = 'D';

    // 5) Сводка для дашборда.
    const summary = {
      products_total: items.length,
      products_with_stock: items.filter((x) => x.stock > 0).length,
      stock_value_total: items.reduce((s, x) => s + x.stock_value, 0),
      revenue_total: items.reduce((s, x) => s + x.revenue, 0),
      qty_sold_total: items.reduce((s, x) => s + x.qty_sold, 0),
      dead_count: items.filter((x) => x.status === 'dead').length,
      dead_value: items.filter((x) => x.status === 'dead').reduce((s, x) => s + x.stock_value, 0),
      urgent_count: items.filter((x) => x.status === 'urgent' || x.status === 'out').length,
      low_count: items.filter((x) => x.status === 'low').length,
      excess_count: items.filter((x) => x.status === 'excess').length,
      excess_value: items.filter((x) => x.status === 'excess').reduce((s, x) => s + x.stock_value, 0),
      abc_a_count: items.filter((x) => x.abc === 'A').length,
      abc_b_count: items.filter((x) => x.abc === 'B').length,
      abc_c_count: items.filter((x) => x.abc === 'C').length,
      abc_d_count: items.filter((x) => x.abc === 'D').length,
      // Средняя оборачиваемость только по A+B (у C/D нет смысла — шум).
      turnover_avg_ab: (() => {
        const abList = items.filter((x) => (x.abc === 'A' || x.abc === 'B') && x.turnover_per_year > 0 && x.turnover_per_year < 999);
        if (!abList.length) return 0;
        return abList.reduce((s, x) => s + x.turnover_per_year, 0) / abList.length;
      })(),
    };

    // 6) Топы для быстрого взгляда.
    const topSelling = [...items].filter((x) => x.qty_sold > 0).sort((a, b) => b.qty_sold - a.qty_sold).slice(0, 10);
    const deadStock = [...items].filter((x) => x.status === 'dead').sort((a, b) => b.stock_value - a.stock_value).slice(0, 20);
    const urgent = [...items].filter((x) => x.status === 'urgent' || x.status === 'out')
      .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999)).slice(0, 20);
    const excess = [...items].filter((x) => x.status === 'excess').sort((a, b) => b.stock_value - a.stock_value).slice(0, 20);

    // 7) Рекомендации — короткие, действенные.
    const recs = [];
    if (summary.urgent_count > 0) recs.push({ level: 'urgent', text: `⚠️ ${summary.urgent_count} товар(ов) закончатся за неделю — закупить срочно` });
    if (summary.out_count > 0) recs.push({ level: 'urgent', text: `🚫 ${summary.out_count} товар(ов) уже закончились, но были продажи` });
    if (summary.dead_count > 5) recs.push({ level: 'warning', text: `📦 ${summary.dead_count} мёртвых позиций на ${Math.round(summary.dead_value).toLocaleString('ru-RU')} ₽ — распродать/списать` });
    if (summary.excess_count > 5) recs.push({ level: 'warning', text: `📈 ${summary.excess_count} позиций с избытком (>180 дней) на ${Math.round(summary.excess_value).toLocaleString('ru-RU')} ₽ — закупать меньше` });
    if (summary.turnover_avg_ab < 4 && summary.turnover_avg_ab > 0) recs.push({ level: 'info', text: `🐢 Оборачиваемость ABC-товаров ${summary.turnover_avg_ab.toFixed(1)}×/год — низкая (норма 6-12×). Замороженные деньги в стоке.` });
    if (summary.turnover_avg_ab > 15) recs.push({ level: 'info', text: `⚡ Оборачиваемость ${summary.turnover_avg_ab.toFixed(1)}×/год — высокая, но есть риск дефицитов. Увеличить безопасный запас топов.` });
    if (!recs.length) recs.push({ level: 'info', text: '✅ Всё под контролем: критичных проблем нет' });

    res.json({
      period_days: days,
      summary,
      recommendations: recs,
      top_selling: topSelling,
      dead_stock: deadStock,
      urgent,
      excess,
      items, // Полный список — фронт фильтрует/сортирует
    });
  }),
);

export default router;
