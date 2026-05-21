import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { notify, notifyWarehouse } from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';

const router = Router();

const SORT_COLUMNS = ['id', 'created_at', 'status', 'total_amount', 'marketplace'];
const STATUSES = ['new', 'reserved', 'shipped', 'completed', 'cancelled'];

const itemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative().default(0),
});

const createSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional().default('RUB'),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'В заказе должна быть хотя бы одна позиция'),
});

const updateSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional(),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1).optional(),
});

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
              (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_count
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
          `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          orderId,
          item.sku ?? null,
          item.name,
          item.quantity,
          item.unit_price,
          item.quantity * item.unit_price,
        );
      }
      return orderId;
    });

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
            `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?)`,
            order.id,
            item.sku ?? null,
            item.name,
            item.quantity,
            item.unit_price,
            lineTotal,
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
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      throw Forbidden('Резервировать может только склад или админ');
    }
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.status !== 'new') throw BadRequest('Зарезервировать можно только новый заказ');
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
