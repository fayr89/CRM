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
const STATUSES = ['waiting_stock', 'new', 'reserved', 'shipped', 'completed', 'cancelled'];

const itemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative().default(0),
  product_id: z.number().int().positive().optional().nullable(),
  image_url: z.string().optional().nullable(),
  catalog_price: z.number().nonnegative().optional().nullable(),
});

// Метаданные прайса и доставки (необязательные).
const pricingMeta = {
  payment_method: z.string().optional().nullable(),
  price_deviation: z.number().optional().nullable(),
  recommended_total: z.number().optional().nullable(),
  shipment_qr: z.string().optional().nullable(),
  delivery_method: z.string().optional().nullable(),
  client_phone: z.string().optional().nullable(),
  avito_dialog_url: z.string().optional().nullable(),
  warehouse: z.string().optional().nullable(),
};

const createSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional().default('RUB'),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'В заказе должна быть хотя бы одна позиция'),
  // Менеджер может создать заказ сразу в статусе «Ожидает товара» (товара ещё нет на складе).
  status: z.enum(['new', 'waiting_stock']).optional(),
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
    data.delivery_method === undefined &&
    data.client_phone === undefined &&
    data.avito_dialog_url === undefined &&
    data.warehouse === undefined
  ) {
    return;
  }
  try {
    await db.run(
      `UPDATE orders SET payment_method = ?, price_deviation = ?, recommended_total = ?,
       shipment_qr = ?, delivery_method = ?, client_phone = ?, avito_dialog_url = ?,
       warehouse = ?, updated_at = NOW() WHERE id = ?`,
      data.payment_method ?? null,
      data.price_deviation ?? null,
      data.recommended_total ?? null,
      data.shipment_qr ?? null,
      data.delivery_method ?? null,
      data.client_phone ?? null,
      data.avito_dialog_url ?? null,
      data.warehouse ?? null,
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
                 ORDER BY id LIMIT 1) AS preview_image,
              (SELECT string_agg(name, ', ') FROM (
                 SELECT name FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 5
               ) t) AS items_preview
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
        key: 'total_qty',
        label: 'Кол-во, шт',
        get: (row) => {
          const list = itemsByOrder.get(row.id) || [];
          return list.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
        },
      },
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

// Возвраты: отменённые заказы, по которым товар был зарезервирован/отгружен.
// Видят склад и админ. status=pending — ждут обработки, else — все возвраты.
router.get(
  '/returns/list',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin', 'aus'].includes(req.user.role)) {
      throw Forbidden('Возвраты видят склад, АУС и админ');
    }
    const onlyPending = req.query.status === 'pending';
    const orders = await db.all(
      `SELECT o.id, o.marketplace, o.client_name, o.total_amount, o.currency,
              o.cancel_reason, o.cancelled_at, o.return_status, o.return_proof,
              o.return_resolved_at, u.name AS manager_name, rb.name AS resolved_by_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users rb ON rb.id = o.return_resolved_by
       WHERE o.return_status IS NOT NULL ${onlyPending ? "AND o.return_status = 'pending'" : ''}
       ORDER BY o.cancelled_at DESC`,
    );
    res.json({ data: orders });
  }),
);

// Обработка возврата складом: restocked (в сток), written_off (списать с пруфом)
// или lost (товар потерян — попадает в «Потерянные товары»).
const returnResolveSchema = z.object({
  resolution: z.enum(['restocked', 'written_off', 'lost']),
  proof: z.string().optional().nullable(), // base64-фото для списания
});
router.post(
  '/:id/return-resolve',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      throw Forbidden('Обрабатывать возвраты может только склад или админ');
    }
    const { resolution, proof } = returnResolveSchema.parse(req.body);
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.return_status !== 'pending') throw BadRequest('Возврат уже обработан или не требуется');
    if (resolution === 'written_off' && !proof) {
      throw BadRequest('Для списания приложите фото-подтверждение, что товар негоден');
    }
    await db.run(
      `UPDATE orders SET return_status = ?, return_proof = ?, return_resolved_by = ?,
       return_resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      resolution,
      resolution === 'written_off' ? proof : null,
      req.user.id,
      order.id,
    );
    res.json(await db.get('SELECT * FROM orders WHERE id = ?', order.id));
  }),
);

// Потерянные товары: заказы, по которым возврат отмечен как «потерян».
// Сумма потерь считается по цене продажи (total_amount). Аннулированные (loss_voided)
// в сумму не входят. Фильтр status: new (новые) | settled (погашены).
router.get(
  '/lost/list',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin', 'aus'].includes(req.user.role)) {
      throw Forbidden('Потерянные товары видят склад, АУС и админ');
    }
    const status = req.query.status === 'settled' ? 'settled' : req.query.status === 'new' ? 'new' : null;
    const statusFilter =
      status === 'new' ? 'AND COALESCE(o.loss_voided, FALSE) = FALSE'
        : status === 'settled' ? 'AND COALESCE(o.loss_voided, FALSE) = TRUE'
          : '';
    const orders = await db.all(
      `SELECT o.id, o.marketplace, o.client_name, o.total_amount, o.currency, o.warehouse,
              o.cancel_reason, o.cancelled_at, o.return_resolved_at, COALESCE(o.loss_voided, FALSE) AS loss_voided,
              u.name AS manager_name, rb.name AS resolved_by_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users rb ON rb.id = o.return_resolved_by
       WHERE o.return_status = 'lost' ${statusFilter}
       ORDER BY o.return_resolved_at DESC NULLS LAST, o.id DESC`,
    );
    const totalLoss = await db.get(
      `SELECT COALESCE(SUM(total_amount), 0) AS sum
       FROM orders WHERE return_status = 'lost' AND COALESCE(loss_voided, FALSE) = FALSE`,
    );
    res.json({ data: orders, total_loss: totalLoss?.sum || 0 });
  }),
);

// Аннулировать потерю (только админ) — позиция перестаёт считаться в сумме потерь.
router.post(
  '/:id/lost-void',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.return_status !== 'lost') throw BadRequest('Заказ не в списке потерянных товаров');
    await db.run('UPDATE orders SET loss_voided = TRUE, updated_at = NOW() WHERE id = ?', order.id);
    res.json(await db.get('SELECT * FROM orders WHERE id = ?', order.id));
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
          total_amount, currency, manager_id, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        data.reference_number ?? null,
        data.marketplace ?? null,
        data.client_classification ?? null,
        data.client_name ?? null,
        totalAmount,
        data.currency ?? 'RUB',
        req.user.id,
        data.notes ?? null,
        data.status ?? 'new',
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

    // B2B: заносим клиента в базу контактов и закрепляем за менеджером (если ещё нет).
    if (data.client_classification === 'B2B' && data.client_name) {
      try {
        let existing = null;
        if (data.client_phone) {
          existing = await db.get('SELECT id FROM contacts WHERE phone = ?', data.client_phone);
        }
        if (!existing) {
          await db.run(
            `INSERT INTO contacts (first_name, phone, owner_id, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())`,
            data.client_name,
            data.client_phone ?? null,
            req.user.id,
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[orders] B2B contact:', e.message);
      }
    }

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
    // Номер отправления обязателен при резерве любого заказа.
    if (!order.shipment_qr || !String(order.shipment_qr).trim()) {
      throw BadRequest('Заполните «Номер отправления» в заказе — он обязателен при резерве.');
    }
    await db.run(
      `UPDATE orders SET status = 'reserved', warehouse_user_id = ?,
       reserved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      req.user.id,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // Касса: при резерве заказ попадает в кассу транзакцией прихода (на подтверждение),
    // если по этому заказу транзакции ещё нет.
    try {
      const existing = await db.get('SELECT id FROM payments WHERE order_id = ?', order.id);
      if (!existing && (order.total_amount || 0) > 0) {
        await db.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'income', 'pending', ?, NOW(), NOW())`,
          order.manager_id,
          order.id,
          order.total_amount,
          order.currency || 'RUB',
          `Заказ #${order.id}${order.marketplace ? ' · ' + order.marketplace : ''}`,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[orders] касса при резерве:', e.message);
    }
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
    // Причина отмены обязательна.
    const reason = z.object({ reason: z.string().min(1, 'Укажите причину отмены') }).parse(req.body || {}).reason;
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    // Отменять может: админ, склад (любой статус), менеджер-владелец (новый или зарезервированный).
    const isAdminOrWarehouse = ['admin', 'warehouse'].includes(req.user.role);
    if (!isAdminOrWarehouse && !(await canAccessOrder(req.user, order))) throw Forbidden();
    if (['completed', 'cancelled'].includes(order.status)) {
      throw BadRequest('Заказ уже закрыт');
    }
    if (!isAdminOrWarehouse && !['new', 'reserved', 'waiting_stock', 'shipped'].includes(order.status)) {
      throw BadRequest('Этот заказ уже нельзя отменить');
    }
    // Если товар был зарезервирован/отгружён — заказ попадает в «Возвраты» на обработку складом.
    // Для waiting_stock и new возврата нет — товар не списывался.
    const needsReturn = ['reserved', 'shipped'].includes(order.status);
    await db.run(
      `UPDATE orders SET status = 'cancelled', cancel_reason = ?,
       return_status = ?, cancelled_from_status = ?, cancelled_at = NOW(), updated_at = NOW() WHERE id = ?`,
      reason ?? null,
      needsReturn ? 'pending' : null,
      order.status,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // Касса: если по заказу была транзакция прихода — отражаем отмену компенсирующим
    // расходом (возврат). Так оборот по отменённому заказу обнуляется и виден в кассе.
    try {
      const income = await db.get(
        `SELECT * FROM payments WHERE order_id = ? AND kind = 'income' ORDER BY id DESC LIMIT 1`,
        order.id,
      );
      if (income) {
        const alreadyReversed = await db.get(
          `SELECT id FROM payments WHERE order_id = ? AND kind = 'expense'`,
          order.id,
        );
        if (!alreadyReversed) {
          await db.run(
            `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'expense', 'pending', ?, NOW(), NOW())`,
            income.manager_id,
            order.id,
            income.amount,
            income.currency || 'RUB',
            `Возврат по отменённому заказу #${order.id}${reason ? ' · ' + reason : ''}`,
          );
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[orders] касса при отмене:', e.message);
    }
    emitEvent('order.cancelled', updated);
    res.json(updated);
  }),
);

// Перевести заказ в «Ожидает товара». Из 'new' — любой владелец/админ;
// из 'reserved' — может склад/админ (товар не нашли при сборке, ждём поставку).
router.post(
  '/:id/mark-waiting',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    const isWarehouseOrAdmin = ['admin', 'warehouse'].includes(req.user.role);
    if (!isWarehouseOrAdmin && !(await canAccessOrder(req.user, order))) throw Forbidden();
    if (order.status === 'new') {
      // ok — любой владелец
    } else if (order.status === 'reserved') {
      if (!isWarehouseOrAdmin) throw Forbidden('Снимать резерв и переводить в «Ожидает товара» может только склад или админ');
    } else {
      throw BadRequest('Перевести в «Ожидает товара» можно из «Новый» или «Зарезервирован»');
    }
    await db.run(
      `UPDATE orders SET status = 'waiting_stock', updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    res.json(updated);
  }),
);

// Откат ошибочной отгрузки: shipped → reserved. Только склад/админ.
router.post(
  '/:id/unship',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      throw Forbidden('Откатить отгрузку может только склад или админ');
    }
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.status !== 'shipped') {
      throw BadRequest('Откатить можно только отгруженный заказ');
    }
    await db.run(
      `UPDATE orders SET status = 'reserved', shipped_at = NULL, updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    res.json(updated);
  }),
);

// Перевести «Ожидает товара» → «Новый» (товар поступил, готов к резерву).
router.post(
  '/:id/mark-ready',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (order.status !== 'waiting_stock') {
      throw BadRequest('Этот заказ не в статусе «Ожидает товара»');
    }
    await db.run(
      `UPDATE orders SET status = 'new', updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    res.json(updated);
  }),
);

// Разделить заказ: отделить часть позиций в новый заказ.
// Разрешено в статусах 'new' и 'reserved'. Нельзя отделить все позиции.
async function performSplit({ original, itemIds, newStatus }) {
  const allItems = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', original.id);
  if (!allItems.length) throw BadRequest('У заказа нет позиций');
  const idSet = new Set(itemIds);
  const moving = allItems.filter((i) => idSet.has(i.id));
  if (moving.length !== itemIds.length) throw BadRequest('Какая-то из выбранных позиций не принадлежит этому заказу');
  if (moving.length === allItems.length) throw BadRequest('Нельзя отделить все позиции — оставьте хотя бы одну в исходном заказе');
  const remaining = allItems.filter((i) => !idSet.has(i.id));
  const movingTotal = moving.reduce((s, i) => s + (i.line_total || 0), 0);
  const remainingTotal = remaining.reduce((s, i) => s + (i.line_total || 0), 0);

  return await db.withTransaction(async (tx) => {
    const r = await tx.run(
      `INSERT INTO orders
       (reference_number, marketplace, client_classification, client_name, client_phone,
        total_amount, currency, manager_id, notes, status, warehouse, payment_method,
        delivery_method, avito_dialog_url, parent_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      original.reference_number ? `${original.reference_number}-split` : null,
      original.marketplace ?? null,
      original.client_classification ?? null,
      original.client_name ?? null,
      original.client_phone ?? null,
      movingTotal,
      original.currency ?? 'RUB',
      original.manager_id,
      `Создан разделением из заказа #${original.id}`,
      newStatus,
      original.warehouse ?? null,
      original.payment_method ?? null,
      original.delivery_method ?? null,
      original.avito_dialog_url ?? null,
      original.id,
    );
    const splitId = r.lastInsertRowid;
    await tx.run(`UPDATE order_items SET order_id = ? WHERE order_id = ? AND id = ANY(?)`, splitId, original.id, itemIds);
    const noteAppend = `Разделён → создан заказ #${splitId}`;
    const newNotes = original.notes ? `${original.notes}\n${noteAppend}` : noteAppend;
    await tx.run('UPDATE orders SET total_amount = ?, notes = ?, updated_at = NOW() WHERE id = ?', remainingTotal, newNotes, original.id);
    return splitId;
  });
}

const splitSchema = z.object({
  item_ids: z.array(z.number().int().positive()).min(1),
  new_status: z.enum(['new', 'waiting_stock']).optional().default('new'),
});
router.post(
  '/:id/split',
  asyncHandler(async (req, res) => {
    const { item_ids, new_status } = splitSchema.parse(req.body || {});
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (!['new', 'reserved'].includes(order.status)) {
      throw BadRequest('Разделять можно только новый или зарезервированный заказ');
    }
    const newId = await performSplit({ original: order, itemIds: item_ids, newStatus: new_status });

    const newOrder = await db.get('SELECT * FROM orders WHERE id = ?', newId);
    const newItems = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', newId);
    const updatedOriginal = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updatedOriginal);
    emitEvent('order.created', { ...newOrder, items: newItems });
    res.status(201).json({ new_order: { ...newOrder, items: newItems }, original: updatedOriginal });
  }),
);

// Действие над отдельной позицией: «Ждём товара» (отделить в waiting_stock) или
// «Отменить» (отделить + сразу отменить). Доступно складу/админу и владельцу.
const extractSchema = z.object({
  action: z.enum(['waiting', 'cancel']),
  reason: z.string().optional().nullable(),
});
router.post(
  '/:id/items/:itemId/extract',
  asyncHandler(async (req, res) => {
    const { action, reason } = extractSchema.parse(req.body || {});
    const itemId = Number(req.params.itemId);
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    const isWarehouseOrAdmin = ['admin', 'warehouse'].includes(req.user.role);
    if (!isWarehouseOrAdmin && !(await canAccessOrder(req.user, order))) throw Forbidden();
    if (!['new', 'reserved'].includes(order.status)) {
      throw BadRequest('Действие доступно только для новых и зарезервированных заказов');
    }
    const item = await db.get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', itemId, order.id);
    if (!item) throw NotFound('Позиция не найдена в заказе');
    if (action === 'cancel' && !reason) throw BadRequest('Укажите причину отмены');

    // waiting → новый заказ сразу в waiting_stock; cancel → новый заказ повторяет статус,
    // потом отменяется (если был reserved — пойдёт в Возвраты на физическую обработку).
    const newStatus = action === 'waiting' ? 'waiting_stock' : order.status;
    const splitId = await performSplit({ original: order, itemIds: [itemId], newStatus });

    if (action === 'cancel') {
      const needsReturn = ['reserved', 'shipped'].includes(order.status);
      await db.run(
        `UPDATE orders SET status='cancelled', cancel_reason=?, return_status=?,
         cancelled_from_status=?, cancelled_at=NOW(), updated_at=NOW() WHERE id=?`,
        reason,
        needsReturn ? 'pending' : null,
        newStatus,
        splitId,
      );
    }

    const newOrder = await db.get('SELECT * FROM orders WHERE id = ?', splitId);
    const newItems = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', splitId);
    const updatedOriginal = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updatedOriginal);
    emitEvent(action === 'cancel' ? 'order.cancelled' : 'order.created', { ...newOrder, items: newItems });
    res.status(201).json({ new_order: { ...newOrder, items: newItems }, original: updatedOriginal });
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
