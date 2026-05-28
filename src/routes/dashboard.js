import { Router } from 'express';
import { ownerScopeClause, getAccessibleUserIds } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const scope = await ownerScopeClause(req.user);
    // Дополнительный фильтр по конкретному owner_id если передан
    const extraOwner = req.query.owner_id ? Number(req.query.owner_id) : null;

    function buildWhere(scopeSql, scopeParams) {
      const where = [];
      const params = [];
      if (scopeSql) {
        where.push(scopeSql);
        params.push(...scopeParams);
      }
      if (extraOwner) {
        where.push('owner_id = ?');
        params.push(extraOwner);
      }
      return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
    }

    const w = buildWhere(scope.sql, scope.params);

    const [companies, contacts, leads, deals] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM companies ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM contacts ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM leads ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM deals ${w.sql}`, ...w.params),
    ]);

    const totals = {
      companies: companies.n,
      contacts: contacts.n,
      leads: leads.n,
      deals: deals.n,
    };

    const leadsByStatus = await db.all(
      `SELECT status, COUNT(*)::int AS count FROM leads ${w.sql} GROUP BY status`,
      ...w.params,
    );

    const dealStats = await db.all(
      `SELECT stage, COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS amount,
              COALESCE(SUM(amount * probability / 100.0), 0)::float AS weighted_amount
       FROM deals ${w.sql} GROUP BY stage`,
      ...w.params,
    );

    const openDeals = dealStats.filter((s) =>
      ['new', 'qualified', 'proposal', 'negotiation'].includes(s.stage),
    );
    const wonDeals = dealStats.find((s) => s.stage === 'won') || { count: 0, amount: 0 };
    const lostDeals = dealStats.find((s) => s.stage === 'lost') || { count: 0, amount: 0 };

    const pipelineValue = openDeals.reduce((acc, s) => acc + Number(s.amount), 0);
    const weightedPipelineValue = openDeals.reduce(
      (acc, s) => acc + Number(s.weighted_amount), 0,
    );

    const closedTotal = wonDeals.count + lostDeals.count;
    const winRate = closedTotal > 0 ? wonDeals.count / closedTotal : 0;

    const upcomingWhereParts = [
      'completed_at IS NULL AND (due_date IS NULL OR due_date >= NOW())',
    ];
    const overdueWhereParts = ['completed_at IS NULL AND due_date < NOW()'];
    const aParams = [];
    if (scope.sql) {
      upcomingWhereParts.push(scope.sql);
      overdueWhereParts.push(scope.sql);
      aParams.push(...scope.params);
    }
    if (extraOwner) {
      upcomingWhereParts.push('owner_id = ?');
      overdueWhereParts.push('owner_id = ?');
      aParams.push(extraOwner);
    }
    const upcoming = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities WHERE ${upcomingWhereParts.join(' AND ')}`,
      ...aParams,
    );
    const overdue = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities WHERE ${overdueWhereParts.join(' AND ')}`,
      ...aParams,
    );

    // Прямые продажи (заказы): фильтр по доступным менеджерам (admin/finance — все).
    const ordIds = await getAccessibleUserIds(req.user);
    const ordWhere = ordIds === null ? '' : 'WHERE manager_id = ANY(?)';
    const ordParams = ordIds === null ? [] : [ordIds];
    const ordersByStatus = await db
      .all(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0)::float AS amount
         FROM orders ${ordWhere} GROUP BY status`,
        ...ordParams,
      )
      .catch(() => []);
    const ordersTotal = ordersByStatus.reduce((s, r) => s + r.count, 0);
    const ordersAmount = ordersByStatus
      .filter((r) => !['cancelled'].includes(r.status))
      .reduce((s, r) => s + r.amount, 0);

    res.json({
      totals,
      leads: { by_status: leadsByStatus },
      deals: {
        by_stage: dealStats,
        pipeline_value: pipelineValue,
        weighted_pipeline_value: weightedPipelineValue,
        won: { count: wonDeals.count, amount: Number(wonDeals.amount) },
        lost: { count: lostDeals.count, amount: Number(lostDeals.amount) },
        win_rate: Number(winRate.toFixed(4)),
      },
      orders: {
        by_status: ordersByStatus,
        total: ordersTotal,
        total_amount: ordersAmount,
      },
      activities: {
        upcoming: upcoming.n,
        overdue: overdue.n,
      },
    });
  }),
);

// Расширенные виджеты дашборда: динамика продаж, топ менеджеров, уценки без цены.
// Доступно admin/rop, остальные — только своя выборка.
// Период: ?period=week (7 дней по дням), month (30 дней по дням), quarter (90 по неделям).
router.get(
  '/insights',
  asyncHandler(async (req, res) => {
    const period = ['week', 'month', 'quarter'].includes(req.query.period) ? req.query.period : 'month';
    const days = period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
    const bucket = period === 'quarter' ? 'week' : 'day';

    const ordIds = await getAccessibleUserIds(req.user);
    // Без алиаса (для запросов с FROM orders) и с алиасом o.
    const scopeWhere = ordIds === null ? '' : 'AND manager_id = ANY(?)';
    const scopeWhereO = ordIds === null ? '' : 'AND o.manager_id = ANY(?)';
    const scopeParams = ordIds === null ? [] : [ordIds];

    // 1) Серия продаж по дням/неделям (только non-cancelled).
    const series = await db.all(
      `SELECT date_trunc('${bucket}', created_at)::date AS bucket,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount), 0)::float AS amount
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '${days} days'
         AND status <> 'cancelled' ${scopeWhere}
       GROUP BY bucket ORDER BY bucket ASC`,
      ...scopeParams,
    );

    // 2) Топ менеджеров за период. Считаем только полностью отгруженные/завершённые —
    // это «реальная» выручка, без учёта будущих отмен.
    const topManagers = await db.all(
      `SELECT u.id, u.name,
              COUNT(o.id)::int AS orders,
              COALESCE(SUM(o.total_amount), 0)::float AS revenue
       FROM orders o
       JOIN users u ON u.id = o.manager_id
       WHERE o.created_at >= NOW() - INTERVAL '${days} days'
         AND o.status IN ('shipped', 'completed') ${scopeWhereO}
       GROUP BY u.id, u.name
       ORDER BY revenue DESC LIMIT 10`,
      ...scopeParams,
    );

    // 3) Уценочные товары без цены — что ждёт админа.
    // Цены лежат в product_prices (по каналу+складу). Считаем «без цены» = нет ни
    // одной записи в product_prices для этого товара.
    const markdownNoPrice = await db.get(
      `SELECT COUNT(*)::int AS n
       FROM products p
       WHERE p.is_markdown = TRUE AND p.active = TRUE
         AND NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)`,
    ).catch(() => ({ n: 0 }));

    const markdownNoPriceList = await db.all(
      `SELECT p.id, p.name, p.sku, p.markdown_order_id, p.stock
       FROM products p
       WHERE p.is_markdown = TRUE AND p.active = TRUE
         AND NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)
       ORDER BY p.id DESC LIMIT 10`,
    ).catch(() => []);

    // 4) Сводка по статусам заказов за тот же период — для подзаголовка к графику.
    const periodTotals = await db.get(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END), 0)::float AS revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM orders
       WHERE created_at >= NOW() - INTERVAL '${days} days' ${scopeWhere}`,
      ...scopeParams,
    );

    res.json({
      period,
      bucket,
      days,
      series,
      top_managers: topManagers,
      markdown_no_price: { count: markdownNoPrice?.n || 0, sample: markdownNoPriceList },
      period_totals: periodTotals || { orders: 0, revenue: 0, cancelled: 0 },
    });
  }),
);

router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const scope = await ownerScopeClause(req.user);
    const w = scope.sql ? `WHERE ${scope.sql}` : '';
    const params = scope.sql ? scope.params : [];
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const [recentLeads, recentContacts, recentDeals, recentActivities] = await Promise.all([
      db.all(`SELECT * FROM leads ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM contacts ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM deals ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM activities ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
    ]);
    res.json({
      leads: recentLeads,
      contacts: recentContacts,
      deals: recentDeals,
      activities: recentActivities,
    });
  }),
);

export default router;
