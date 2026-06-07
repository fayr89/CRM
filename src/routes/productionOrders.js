// Производственные заказы: план выпуска товара штуками за период с разбивкой по дням.
// Мастер видит только заказы где он назначен foreman_id (упрощённое допущение,
// уточним если нужно: «свои» = назначенный foreman или master attached).
// Эндпоинт «Выполнили заказ» (создание technological-операции в МойСклад) —
// будет добавлен в следующей итерации (Компонент 2.2 по ТЗ).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { parsePagination, paginated } from '../query.js';
import { msCreate, msHref } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

const router = Router();
router.use(authenticate);

function canEdit(user) {
  return ['admin', 'director_prod', 'foreman'].includes(user.role);
}
function isMaster(user) {
  return user.role === 'master';
}
// Видимость: admin/director_prod/supply видят все, foreman — где он назначен,
// master — где он назначен (через foreman_id; multi-master реализуем позже
// при необходимости).
async function scopeWhere(user) {
  if (['admin', 'director_prod', 'supply'].includes(user.role)) return { sql: '', params: [] };
  if (['foreman', 'master'].includes(user.role)) return { sql: 'foreman_id = ?', params: [user.id] };
  return { sql: '1=0', params: [] };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const scope = await scopeWhere(req.user);
    const where = [];
    const params = [];
    if (scope.sql) { where.push(scope.sql); params.push(...scope.params); }
    if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
    if (req.query.product_id) { where.push('product_id = ?'); params.push(Number(req.query.product_id)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT po.*, p.name AS product_name, p.sku AS product_sku,
              u.name AS foreman_name
       FROM production_orders po
       JOIN products p ON p.id = po.product_id
       LEFT JOIN users u ON u.id = po.foreman_id
       ${whereSql} ORDER BY po.period_from DESC, po.id DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM production_orders po ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await db.get(
      `SELECT po.*, p.name AS product_name, p.sku AS product_sku,
              u.name AS foreman_name
       FROM production_orders po
       JOIN products p ON p.id = po.product_id
       LEFT JOIN users u ON u.id = po.foreman_id
       WHERE po.id = ?`,
      req.params.id,
    );
    if (!order) throw NotFound('Производственный заказ не найден');
    // Master видит только свои.
    if (isMaster(req.user) && order.foreman_id !== req.user.id) {
      throw NotFound('Производственный заказ не найден');
    }
    const days = await db.all(
      'SELECT * FROM production_order_days WHERE production_order_id = ? ORDER BY day ASC',
      order.id,
    );
    order.days = days;
    res.json(order);
  }),
);

const orderSchema = z.object({
  product_id: z.number().int().positive(),
  plan_qty: z.number().int().positive(),
  period_from: z.string().min(10), // YYYY-MM-DD
  period_to: z.string().min(10),
  foreman_id: z.number().int().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  // Дневная разбивка: либо передают list, либо распределим автоматически (равными долями).
  days: z.array(z.object({
    day: z.string().min(10),
    plan_qty: z.number().int().nonnegative(),
  })).optional(),
});

function defaultDaysSplit(from, to, totalQty) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const days = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  if (!days.length) return [];
  const per = Math.floor(totalQty / days.length);
  const rem = totalQty - per * days.length;
  return days.map((day, i) => ({ day, plan_qty: per + (i < rem ? 1 : 0) }));
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или начальнику цеха');
    const data = orderSchema.parse(req.body || {});
    const created = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO production_orders (product_id, plan_qty, period_from, period_to, foreman_id, notes, created_by, status)
         VALUES (?, ?, ?::date, ?::date, ?, ?, ?, 'draft') RETURNING id`,
        data.product_id, data.plan_qty, data.period_from, data.period_to,
        data.foreman_id ?? null, data.notes ?? null, req.user.id,
      );
      const orderId = r.lastInsertRowid;
      const days = data.days?.length ? data.days : defaultDaysSplit(data.period_from, data.period_to, data.plan_qty);
      for (const d of days) {
        await tx.run(
          `INSERT INTO production_order_days (production_order_id, day, plan_qty) VALUES (?, ?::date, ?)`,
          orderId, d.day, d.plan_qty,
        );
      }
      return orderId;
    });
    await logAction(req, { action: 'production_order.created', entity_type: 'production_order', entity_id: created });
    const full = await db.get(
      `SELECT po.*, p.name AS product_name FROM production_orders po
       JOIN products p ON p.id = po.product_id WHERE po.id = ?`,
      created,
    );
    full.days = await db.all('SELECT * FROM production_order_days WHERE production_order_id = ? ORDER BY day', created);
    res.status(201).json(full);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или начальнику цеха');
    const data = orderSchema.partial().parse(req.body || {});
    const cur = await db.get('SELECT * FROM production_orders WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Производственный заказ не найден');
    const fields = ['plan_qty', 'period_from', 'period_to', 'foreman_id', 'notes'];
    const updates = [];
    const params = [];
    const changes = [];
    for (const k of fields) {
      if (data[k] === undefined) continue;
      const newVal = data[k] ?? null;
      const oldVal = cur[k];
      if (String(newVal) !== String(oldVal)) {
        updates.push(`${k} = ?`);
        params.push(newVal);
        changes.push({ field: k, old: oldVal, neu: newVal });
      }
    }
    if (updates.length) {
      updates.push('updated_at = NOW()');
      params.push(cur.id);
      await db.run(`UPDATE production_orders SET ${updates.join(', ')} WHERE id = ?`, ...params);
      // Фиксируем значимые изменения в журнал, если заказ был утверждён.
      if (['approved', 'in_progress', 'done'].includes(cur.status)) {
        for (const c of changes) {
          await db.run(
            `INSERT INTO production_plan_changes (production_order_id, field, old_value, new_value, reason, changed_by)
             VALUES (?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
            cur.id, c.field, JSON.stringify(c.old), JSON.stringify(c.neu),
            req.body?.reason ?? null, req.user.id,
          );
        }
      }
    }
    await logAction(req, { action: 'production_order.updated', entity_type: 'production_order', entity_id: cur.id, details: { fields: changes.map((c) => c.field) } });
    res.json(await db.get('SELECT * FROM production_orders WHERE id = ?', cur.id));
  }),
);

// Утверждение плана: status draft → approved.
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или начальнику цеха');
    const cur = await db.get('SELECT * FROM production_orders WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Производственный заказ не найден');
    if (cur.status !== 'draft') throw BadRequest('Утвердить можно только черновик');
    await db.run(
      `UPDATE production_orders SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      req.user.id, cur.id,
    );
    await logAction(req, { action: 'production_order.approved', entity_type: 'production_order', entity_id: cur.id });
    res.json(await db.get('SELECT * FROM production_orders WHERE id = ?', cur.id));
  }),
);

// Ввод факта по дню. Доступен мастеру (на свои заказы) и foreman/director.
// over_plan ставится автоматически если fact_qty > plan_qty этого дня.
// backdated — если запись делается не в день day.
const factSchema = z.object({
  day: z.string().min(10),
  fact_qty: z.number().int().nonnegative(),
  note: z.string().max(500).optional().nullable(),
});

router.post(
  '/:id/fact',
  asyncHandler(async (req, res) => {
    const data = factSchema.parse(req.body || {});
    const cur = await db.get('SELECT * FROM production_orders WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Производственный заказ не найден');
    if (isMaster(req.user) && cur.foreman_id !== req.user.id) {
      throw NotFound('Производственный заказ не найден');
    }
    if (!['approved', 'in_progress'].includes(cur.status)) {
      throw BadRequest('Факт можно вносить только в утверждённый/в работе заказ');
    }
    const day = await db.get(
      'SELECT * FROM production_order_days WHERE production_order_id = ? AND day = ?::date',
      cur.id, data.day,
    );
    if (!day) throw BadRequest('В плане нет такого дня');
    const today = new Date().toISOString().slice(0, 10);
    const backdated = data.day !== today;
    const overPlan = data.fact_qty > day.plan_qty;
    await db.withTransaction(async (tx) => {
      await tx.run(
        `UPDATE production_order_days SET fact_qty = ?, backdated = ?, over_plan = ?, note = ?, updated_at = NOW()
         WHERE id = ?`,
        data.fact_qty, backdated || day.backdated, overPlan, data.note ?? day.note, day.id,
      );
      // Пересчитать общий fact_qty заказа.
      const { sum } = await tx.get(
        `SELECT COALESCE(SUM(fact_qty), 0)::int AS sum FROM production_order_days WHERE production_order_id = ?`,
        cur.id,
      );
      const newStatus = cur.status === 'approved' && sum > 0 ? 'in_progress' : cur.status;
      const completed = sum >= cur.plan_qty;
      await tx.run(
        `UPDATE production_orders SET fact_qty = ?, status = ?, updated_at = NOW() WHERE id = ?`,
        sum, completed ? 'done' : newStatus, cur.id,
      );
    });
    await logAction(req, {
      action: 'production_order.fact',
      entity_type: 'production_order',
      entity_id: cur.id,
      details: { day: data.day, fact_qty: data.fact_qty, backdated, over_plan: overPlan },
    });
    res.json({ ok: true, backdated, over_plan: overPlan });
  }),
);

// «Выполнили заказ N штук»: списать материалы по техкарте × N в МС, оприходовать
// готовый товар на внутренний склад производства, увеличить fact_qty. Если МС
// настроен (есть токен и внутренний склад) — создаёт processing-документ.
// Если нет МС — просто увеличивает fact_qty в нашей БД.
const executeSchema = z.object({
  qty: z.number().int().positive(),
  day: z.string().optional(), // YYYY-MM-DD для production_order_days; default today
});
router.post(
  '/:id/execute',
  asyncHandler(async (req, res) => {
    const data = executeSchema.parse(req.body || {});
    const order = await db.get(
      `SELECT po.*, p.id AS product_id, p.name AS product_name, p.ms_id AS product_ms_id
       FROM production_orders po JOIN products p ON p.id = po.product_id WHERE po.id = ?`,
      req.params.id,
    );
    if (!order) throw NotFound('Производственный заказ не найден');
    if (!['admin', 'director_prod', 'foreman', 'master'].includes(req.user.role)) {
      throw BadRequest('Доступ только производственным ролям');
    }
    if (isMaster(req.user) && order.foreman_id !== req.user.id) throw NotFound('Не найден');
    if (!['approved', 'in_progress'].includes(order.status)) {
      throw BadRequest('Выполнять можно только утверждённый или в работе заказ');
    }
    // Берём техкарту товара.
    const plan = await db.get('SELECT * FROM processing_plans WHERE product_id = ?', order.product_id);
    if (!plan) throw BadRequest('Для этого товара нет техкарты — добавьте её сначала');
    const planItems = await db.all(
      `SELECT pi.material_id, pi.qty_per_unit, m.cost_price, m.ms_id, m.name AS material_name
       FROM processing_plan_items pi JOIN materials m ON m.id = pi.material_id
       WHERE pi.plan_id = ?`,
      plan.id,
    );
    const stages = await db.all('SELECT minutes FROM processing_plan_stages WHERE plan_id = ?', plan.id);
    const laborMin = stages.length ? stages.reduce((s, x) => s + Number(x.minutes || 0), 0) : Number(plan.labor_minutes_per_unit || 0);
    const rateRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
    const rate = Number(rateRow?.value) || 0;
    const materialsCost = planItems.reduce((s, i) => s + Number(i.cost_price || 0) * Number(i.qty_per_unit || 0) * data.qty, 0);
    const laborCost = laborMin * rate * data.qty;
    const operationCost = Math.round((materialsCost + laborCost) * 100) / 100;

    // Пытаемся создать processing в МС (если есть токен, внутренний склад, ms_id товара).
    const token = await getMsToken();
    const intWh = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
    const internalWarehouse = intWh?.value;
    let msProcessingId = null;
    let msSyncError = null;
    if (token && internalWarehouse?.id && order.product_ms_id) {
      const missingMats = planItems.filter((i) => !i.ms_id);
      if (missingMats.length) {
        msSyncError = `Не синхронизированы материалы в МС: ${missingMats.map((m) => m.material_name).join(', ')}`;
      } else {
        try {
          const body = {
            materials: planItems.map((i) => ({
              assortment: { meta: { href: msHref('product', i.ms_id), type: 'product', mediaType: 'application/json' } },
              quantity: Number(i.qty_per_unit) * data.qty,
            })),
            products: [{
              assortment: { meta: { href: msHref('product', order.product_ms_id), type: 'product', mediaType: 'application/json' } },
              quantity: data.qty,
            }],
            materialsStore: { meta: { href: msHref('store', internalWarehouse.id), type: 'store', mediaType: 'application/json' } },
            store: { meta: { href: msHref('store', internalWarehouse.id), type: 'store', mediaType: 'application/json' } },
            moment: new Date().toISOString().slice(0, 19).replace('T', ' '),
          };
          const created = await msCreate(token, 'processing', body);
          msProcessingId = created.id;
        } catch (e) {
          msSyncError = String(e.message).slice(0, 500);
        }
      }
    } else if (!token) {
      msSyncError = 'Токен МС не настроен';
    } else if (!internalWarehouse?.id) {
      msSyncError = 'Внутренний склад производства не задан';
    } else if (!order.product_ms_id) {
      msSyncError = 'У готового товара нет ms_id (нужно импортировать из МС)';
    }

    // Обновляем нашу БД (в любом случае фиксируем выполнение).
    const day = data.day || new Date().toISOString().slice(0, 10);
    await db.withTransaction(async (tx) => {
      // production_order_days: ищем строку для этого дня, добавляем qty.
      const dayRow = await tx.get(
        'SELECT * FROM production_order_days WHERE production_order_id = ? AND day = ?::date',
        order.id, day,
      );
      if (dayRow) {
        const today = new Date().toISOString().slice(0, 10);
        await tx.run(
          `UPDATE production_order_days SET fact_qty = fact_qty + ?, backdated = ?, over_plan = (fact_qty + ?) > plan_qty, updated_at = NOW() WHERE id = ?`,
          data.qty, day !== today || dayRow.backdated, data.qty, dayRow.id,
        );
      } else {
        await tx.run(
          `INSERT INTO production_order_days (production_order_id, day, plan_qty, fact_qty, backdated, over_plan)
           VALUES (?, ?::date, 0, ?, ?, TRUE)`,
          order.id, day, data.qty, day !== new Date().toISOString().slice(0, 10),
        );
      }
      const { sum } = await tx.get(
        'SELECT COALESCE(SUM(fact_qty), 0)::int AS sum FROM production_order_days WHERE production_order_id = ?',
        order.id,
      );
      const completed = sum >= order.plan_qty;
      await tx.run(
        `UPDATE production_orders SET fact_qty = ?, status = CASE WHEN status = 'approved' THEN 'in_progress' ELSE status END,
         cost_total = cost_total + ?, ms_processing_id = COALESCE(?, ms_processing_id), updated_at = NOW() WHERE id = ?`,
        sum, operationCost, msProcessingId, order.id,
      );
      if (completed) {
        await tx.run(`UPDATE production_orders SET status = 'done' WHERE id = ?`, order.id);
      }
    });
    await logAction(req, {
      action: 'production_order.executed',
      entity_type: 'production_order',
      entity_id: order.id,
      details: { qty: data.qty, ms_processing_id: msProcessingId, ms_sync_error: msSyncError, operation_cost: operationCost },
    });
    res.json({ ok: true, qty: data.qty, operation_cost: operationCost, ms_processing_id: msProcessingId, ms_sync_error: msSyncError });
  }),
);

// Закрытие/отмена. delete оставлено для очистки черновиков.
router.delete(
  '/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT * FROM production_orders WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Производственный заказ не найден');
    if (cur.status !== 'draft') {
      // Не-черновики переводим в cancelled, не удаляем (нужна история).
      await db.run(
        `UPDATE production_orders SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
        cur.id,
      );
      await logAction(req, { action: 'production_order.cancelled', entity_type: 'production_order', entity_id: cur.id });
      return res.json({ cancelled: true });
    }
    await db.run('DELETE FROM production_orders WHERE id = ?', cur.id);
    await logAction(req, { action: 'production_order.deleted', entity_type: 'production_order', entity_id: cur.id });
    res.status(204).send();
  }),
);

export default router;
