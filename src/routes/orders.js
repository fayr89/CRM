import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { notify, notifyWarehouse } from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';
import { toCsv, csvDate } from '../services/csv.js';
import { nextShippingDate, getSchedule } from '../services/shippingSchedule.js';

const router = Router();

const SORT_COLUMNS = ['id', 'created_at', 'status', 'total_amount', 'marketplace'];
const STATUSES = ['new', 'reserved', 'shipped', 'completed', 'cancelled'];

const itemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative().default(0),
  product_id: z.number().int().positive().optional().nullable(),
  image_url: z.string().optional().nullable(),
  catalog_price: z.number().nonnegative().optional().nullable(),
});

// Метаданные прайса (необязательные): способ оплаты и отклонение цены от прайса.
const pricingMeta = {
  payment_method: z.string().optional().nullable(),
  price_deviation: z.number().optional().nullable(),
  recommended_total: z.number().optional().nullable(),
  shipment_qr: z.string().optional().nullable(),
  delivery_method: z.string().optional().nullable(),
};

const createSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional().default('RUB'),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'В заказе должна быть хотя бы одна позиция'),
  ...pricingMeta,
});

const updateSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1).optional(),
  ...pricingMeta,
});

// Пишем метаданные прайса отдельным «best-effort» запросом ПОСЛЕ создания/обновления
// заказа: даже если колонок ещё нет на этом соединении, сам заказ не сломается.
async function saveOrderPricingMeta(orderId, data) {
  if (
    data.payment_method === undefined &&
    data.price_deviation === undefined &&
    data.recommended_total === undefined &&
    data.shipment_qr === undefined &&
    data.delivery_method === undefined
  ) {
    return;
  }
  try {
    await db.run(
      `UPDATE orders SET payment_method = ?, price_deviation = ?, recommended_total = ?,
       shipment_qr = ?, delivery_method = ?, updated_at = NOW() WHERE id = ?`,
      data.payment_method ?? null,
      data.price_deviation ?? null,
      data.recommended_total ?? null,
      data.shipment_qr ?? null,
      data.delivery_method ?? null,
      orderId,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[orders] не удалось записать метаданные прайса:', e.message);
  }
}

router.use(authenticate);

// Видимость заказов:
//   admin / warehouse — все
//   manager           — свои + подчинённых
//   sales             — только свои (он сам как manager_id)
async function orderScope(user) {
  if (user.role === 'admin' || user.role === 'warehouse') {
    return { sql: '', params: [] };
  }
  if (user.role === 'sales') {
    return { sql: 'manager_id = ?', params: [user.id] };
  }
  const ids = await getAccessibleUserIds(user);
  return { sql: 'manager_id = ANY(?)', params: [ids] };
}

async function canAccessOrder(user, order) {
  if (user.role === 'admin' || user.role === 'warehouse') return true;
  return canAccessUser(user, order.manager_id);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'created_at', 'DESC');

    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    if (req.query.marketplace) {
      where.push('o.marketplace = ?');
      params.push(req.query.marketplace);
    }
    if (req.query.manager_id) {
      where.push('o.manager_id = ?');
      params.push(Number(req.query.manager_id));
    }
    if (req.query.search) {
      where.push(
        '(o.reference_number ILIKE ? OR o.client_name ILIKE ? OR o.notes ILIKE ?)',
      );
      const s = `%${req.query.search}%`;
      params.push(s, s, s);
    }
    const scope = await orderScope(req.user);
    if (scope.sql) {
      where.push(scope.sql.replace(/manager_id/g, 'o.manager_id'));
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT o.*, u.name AS manager_name, w.name AS warehouse_user_name,
              (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_count,
              (SELECT image_url FROM order_items
                 WHERE order_id = o.id AND image_url IS NOT NULL
                 ORDER BY id LIMIT 1) AS preview_image
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users w ON w.id = o.warehouse_user_id
       ${whereSql} ORDER BY o.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM orders o ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

// Экспорт заказов в CSV (открывается в Excel напрямую).
// Фильтры (status, marketplace, manager_id) применяются как в обычном GET /.
router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    if (req.query.marketplace) {
      where.push('o.marketplace = ?');
      params.push(req.query.marketplace);
    }
    if (req.query.manager_id) {
      where.push('o.manager_id = ?');
      params.push(Number(req.query.manager_id));
    }
    // Видимость: то же что в orderScope.
    if (req.user.role === 'sales') {
      where.push('o.manager_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'manager') {
      const ids = await getAccessibleUserIds(req.user);
      where.push('o.manager_id = ANY(?)');
      params.push(ids);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orders = await db.all(
      `SELECT o.*, u.name AS manager_name, w.name AS warehouse_user_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users w ON w.id = o.warehouse_user_id
       ${whereSql} ORDER BY o.created_at DESC LIMIT 5000`,
      ...params,
    );

    // Подтянем позиции одним запросом
    const ids = orders.map((o) => o.id);
    const items = ids.length
      ? await db.all(
          `SELECT order_id, sku, name, quantity, unit_price
           FROM order_items WHERE order_id = ANY(?)
           ORDER BY order_id, id`,
          ids,
        )
      : [];
    const itemsByOrder = new Map();
    for (const it of items) {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id).push(it);
    }

    const columns = [
      { key: 'id', label: 'ID', format: (v) => `#${v}` },
      { key: 'created_at', label: 'Создан', format: csvDate },
      { key: 'marketplace', label: 'Площадка' },
      { key: 'reference_number', label: 'Внешний №' },
      { key: 'client_classification', label: 'Класс клиента' },
      { key: 'client_name', label: 'Клиент' },
      { key: 'status', label: 'Статус' },
      { key: 'payment_method', label: 'Способ оплаты' },
      { key: 'delivery_method', label: 'Способ отправки' },
      { key: 'shipment_qr', label: 'QR код отгрузки' },
      { key: 'manager_name', label: 'Менеджер' },
      { key: 'warehouse_user_name', label: 'Склад' },
      { key: 'reserved_at', label: 'Зарезервирован', format: csvDate },
      { key: 'shipped_at', label: 'Отгружен', format: csvDate },
      { key: 'completed_at', label: 'Завершён', format: csvDate },
      { key: 'total_amount', label: 'Сумма' },
      { key: 'currency', label: 'Валюта' },
      {
        key: 'items',
        label: 'Позиции',
        get: (row) => {
          const list = itemsByOrder.get(row.id) || [];
          return list.map((i) => `${i.sku || ''} ${i.name} × ${i.quantity}`).join(' | ');
        },
      },
      { key: 'notes', label: 'Заметки' },
    ];

    const csv = toCsv(orders, columns);
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

// Список заказов «к отгрузке сегодня» — на основе графика отгрузок и статуса 'reserved'.
router.get(
  '/ready-to-ship',
  asyncHandler(async (req, res) => {
    const schedule = await getSchedule();
    const next = schedule ? nextShippingDate(schedule.days, schedule.cutoff_time) : null;
    const orders = await db.all(
      `SELECT o.id, o.reference_number, o.marketplace, o.client_name,
              o.total_amount, o.currency, o.manager_id, o.reserved_at,
              o.payment_method, o.shipment_qr,
              u.name AS manager_name,
              (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       WHERE o.status = 'reserved'
       ORDER BY o.reserved_at ASC`,
    );
    res.json({
      next_shipping_date: next ? next.toISOString() : null,
      schedule: schedule
        ? { days: schedule.days, cutoff_time: schedule.cutoff_time }
        : null,
      data: orders,
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await db.get(
      `SELECT o.*, u.name AS manager_name, w.name AS warehouse_user_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users w ON w.id = o.warehouse_user_id
       WHERE o.id = ?`,
      req.params.id,
    );
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    const items = await db.all(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id',
      order.id,
    );
    res.json({ ...order, items });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!['manager', 'admin', 'sales'].includes(req.user.role)) {
      throw Forbidden('Создавать заказы могут менеджеры и продажники');
    }
    const data = createSchema.parse(req.body);
    const totalAmount = data.items.reduce(
      (sum, i) => sum + i.quantity * i.unit_price,
      0,
    );

    const newId = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO orders
         (reference_number, marketplace, client_classification, client_name,
          total_amount, currency, manager_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        data.reference_number ?? null,
        data.marketplace ?? null,
        data.client_classification ?? null,
        data.client_name ?? null,
        totalAmount,
        data.currency ?? 'RUB',
        req.user.id,
        data.notes ?? null,
      );
      const orderId = r.lastInsertRowid;
      for (const item of data.items) {
        await tx.run(
          `INSERT INTO order_items
            (order_id, sku, name, quantity, unit_price, line_total,
             product_id, image_url, catalog_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId,
          item.sku ?? null,
          item.name,
          item.quantity,
          item.unit_price,
          item.quantity * item.unit_price,
          item.product_id ?? null,
          item.image_url ?? null,
          item.catalog_price ?? null,
        );
      }
      return orderId;
    });

    await saveOrderPricingMeta(newId, data);

    const order = await db.get('SELECT * FROM orders WHERE id = ?', newId);
    const items = await db.all(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id',
      newId,
    );
    await notifyWarehouse(
      'order.created',
      'Новый заказ ожидает резерва',
      `${order.client_name || order.reference_number || '#' + newId} · ${(order.total_amount || 0).toLocaleString('ru-RU')} ₽`,
      '#/orders',
    );
    emitEvent('order.created', { ...order, items });
    res.status(201).json({ ...order, items });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (req.user.role !== 'admin' && order.status !== 'new') {
      throw BadRequest('Менять заказ можно только пока он в статусе «новый»');
    }

    await db.withTransaction(async (tx) => {
      const updates = [];
      const params = [];
      for (const key of [
        'reference_number',
        'marketplace',
        'client_classification',
        'client_name',
        'currency',
        'notes',
      ]) {
        if (data[key] !== undefined) {
          updates.push(`${key} = ?`);
          params.push(data[key] === '' ? null : data[key]);
        }
      }

      if (data.items) {
        await tx.run('DELETE FROM order_items WHERE order_id = ?', order.id);
        let total = 0;
        for (const item of data.items) {
          const lineTotal = item.quantity * item.unit_price;
          total += lineTotal;
          await tx.run(
            `INSERT INTO order_items
              (order_id, sku, name, quantity, unit_price, line_total,
               product_id, image_url, catalog_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            order.id,
            item.sku ?? null,
            item.name,
            item.quantity,
            item.unit_price,
            lineTotal,
            item.product_id ?? null,
            item.image_url ?? null,
            item.catalog_price ?? null,
          );
        }
        updates.push('total_amount = ?');
        params.push(total);
      }

      if (updates.length) {
        updates.push('updated_at = NOW()');
        params.push(order.id);
        await tx.run(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, ...params);
      }
    });

    await saveOrderPricingMeta(order.id, data);

    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    const items = await db.all(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id',
      order.id,
    );
    res.json({ ...updated, items });
  }),
);

router.post(
  '/:id/reserve',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    // Резервирует менеджер-владелец заказа (или РОП/админ/склад).
    if (!(await canAccessOrder(req.user, order))) {
      throw Forbidden('Нет прав на этот заказ');
    }
    if (order.status !== 'new') throw BadRequest('Зарезервировать можно только новый заказ');
    // QR обязателен для Avito + «Авито доставка» — отсутствие допустимо только в статусе «новый».
    if (order.marketplace === 'Avito' && order.payment_method === 'avito_delivery' && !order.shipment_qr) {
      throw BadRequest('Для площадки Avito и способа «Авито доставка» нужен QR код отгрузки. Добавьте его в заказ.');
    }
    await db.run(
      `UPDATE orders SET status = 'reserved', warehouse_user_id = ?,
       reserved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      req.user.id,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    await notify(
      order.manager_id,
      'order.reserved',
      'Заказ зарезервирован',
      `${order.client_name || order.reference_number || '#' + order.id} · склад готов отгружать`,
      '#/orders',
    );
    emitEvent('order.reserved', updated);
    res.json(updated);
  }),
);

router.post(
  '/:id/ship',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      throw Forbidden('Отгружать может только склад или админ');
    }
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.status !== 'reserved') {
      throw BadRequest('Отгрузить можно только зарезервированный заказ');
    }
    await db.run(
      `UPDATE orders SET status = 'shipped', shipped_at = NOW(),
       updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    await notify(
      order.manager_id,
      'order.shipped',
      'Заказ отгружен',
      `${order.client_name || order.reference_number || '#' + order.id} · можно завершать`,
      '#/orders',
    );
    emitEvent('order.shipped', updated);
    res.json(updated);
  }),
);

// Массовое подтверждение отгрузки (склад выбирает заказы и отгружает разом).
router.post(
  '/ship-bulk',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      throw Forbidden('Отгружать может только склад или админ');
    }
    const ids = z.array(z.number().int().positive()).min(1).max(1000).parse(req.body?.ids || []);
    const orders = await db.all(
      `SELECT * FROM orders WHERE id = ANY(?) AND status = 'reserved'`,
      ids,
    );
    if (!orders.length) {
      return res.json({ ok: true, shipped: 0, skipped: ids.length });
    }
    const shippedIds = orders.map((o) => o.id);
    await db.run(
      `UPDATE orders SET status = 'shipped', shipped_at = NOW(), updated_at = NOW()
       WHERE id = ANY(?)`,
      shippedIds,
    );
    // Уведомляем менеджеров каждого заказа.
    for (const order of orders) {
      await notify(
        order.manager_id,
        'order.shipped',
        'Заказ отгружен',
        `${order.client_name || order.reference_number || '#' + order.id} · можно завершать`,
        '#/orders',
      );
      emitEvent('order.shipped', { ...order, status: 'shipped' });
    }
    res.json({ ok: true, shipped: shippedIds.length, skipped: ids.length - shippedIds.length });
  }),
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (order.status !== 'shipped') {
      throw BadRequest('Завершить можно только отгруженный заказ');
    }
    await db.run(
      `UPDATE orders SET status = 'completed', completed_at = NOW(),
       updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.completed', updated);
    res.json(updated);
  }),
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const reason = z.object({ reason: z.string().optional() }).parse(req.body || {}).reason;
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (['completed', 'cancelled'].includes(order.status)) {
      throw BadRequest('Заказ уже закрыт');
    }
    if (req.user.role !== 'admin' && order.status !== 'new') {
      throw BadRequest('Менеджер может отменить только новый заказ');
    }
    await db.run(
      `UPDATE orders SET status = 'cancelled', cancel_reason = ?,
       cancelled_at = NOW(), updated_at = NOW() WHERE id = ?`,
      reason ?? null,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.cancelled', updated);
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM orders WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Заказ не найден');
    res.status(204).send();
  }),
);

export default router;
