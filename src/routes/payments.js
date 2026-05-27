import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';
import { notify } from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';

const router = Router();

const METHODS = ['cash', 'card', 'bank_transfer', 'other'];
const STATUSES = ['pending', 'confirmed', 'rejected'];

const KINDS = ['income', 'expense'];

const createSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).optional().default('RUB'),
  method: z.enum(METHODS).optional().nullable(),
  reference: z.string().optional().nullable(),
  order_id: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  commission: z.number().nonnegative().optional().nullable(),
  kind: z.enum(KINDS).optional().default('income'),
});

const updateSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  method: z.enum(METHODS).optional().nullable(),
  reference: z.string().optional().nullable(),
  order_id: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  commission: z.number().nonnegative().optional().nullable(),
  kind: z.enum(KINDS).optional(),
});

router.use(authenticate);

// Видимость:
//   admin — все
//   manager — свои + подчинённых
//   sales — свои
//   warehouse — никакие (не видит платежи)
async function paymentsScope(user, col = 'manager_id') {
  if (user.role === 'admin' || user.role === 'finance') return { sql: '', params: [] };
  if (user.role === 'warehouse' || user.role === 'aus') return { sql: '1=0', params: [] };
  if (user.role === 'sales' || user.role === 'manager') {
    return { sql: `${col} = ?`, params: [user.id] };
  }
  const ids = await getAccessibleUserIds(user);
  return { sql: `${col} = ANY(?)`, params: [ids] };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.manager_id) {
      where.push('p.manager_id = ?');
      params.push(Number(req.query.manager_id));
    }
    if (req.query.order_id) {
      where.push('p.order_id = ?');
      params.push(Number(req.query.order_id));
    }
    const scope = await paymentsScope(req.user, 'p.manager_id');
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT p.*, u.name AS manager_name, cu.name AS confirmer_name,
              o.reference_number AS order_reference
       FROM payments p
       LEFT JOIN users u ON u.id = p.manager_id
       LEFT JOIN users cu ON cu.id = p.confirmed_by
       LEFT JOIN orders o ON o.id = p.order_id
       ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM payments p ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!payment) throw NotFound('Платёж не найден');
    if (
      req.user.role !== 'admin' &&
      !(await canAccessUser(req.user, payment.manager_id))
    ) {
      throw Forbidden();
    }
    res.json(payment);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!['manager', 'sales', 'admin'].includes(req.user.role)) {
      throw Forbidden('Платежи добавляют менеджеры и продажники');
    }
    const data = createSchema.parse(req.body);
    if (data.order_id) {
      const order = await db.get('SELECT * FROM orders WHERE id = ?', data.order_id);
      if (!order) throw BadRequest('Указанный заказ не найден');
    }
    const result = await db.run(
      `INSERT INTO payments (manager_id, order_id, amount, currency, method, reference, notes, commission, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      req.user.id,
      data.order_id ?? null,
      data.amount,
      data.currency ?? 'RUB',
      data.method ?? null,
      data.reference ?? null,
      data.notes ?? null,
      data.commission ?? null,
      data.kind ?? 'income',
    );
    res
      .status(201)
      .json(await db.get('SELECT * FROM payments WHERE id = ?', result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!payment) throw NotFound('Платёж не найден');
    const isFinanceOrAdmin = req.user.role === 'admin' || req.user.role === 'finance';
    if (!isFinanceOrAdmin && payment.manager_id !== req.user.id) {
      throw Forbidden();
    }
    // Финансист/админ могут править (в т.ч. комиссию) на любом статусе; остальные — только pending.
    if (payment.status !== 'pending' && !isFinanceOrAdmin) {
      throw BadRequest('Менять можно только платёж в статусе «на подтверждении»');
    }
    const updates = [];
    const params = [];
    for (const key of ['amount', 'currency', 'method', 'reference', 'order_id', 'notes', 'commission', 'kind']) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(payment);
    updates.push('updated_at = NOW()');
    params.push(payment.id);
    await db.run(`UPDATE payments SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM payments WHERE id = ?', payment.id));
  }),
);

router.post(
  '/:id/confirm',
  requireRole('admin', 'finance'),
  asyncHandler(async (req, res) => {
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!payment) throw NotFound('Платёж не найден');
    if (payment.status !== 'pending') throw BadRequest('Этот платёж уже обработан');
    await db.run(
      `UPDATE payments SET status = 'confirmed', confirmed_by = ?, confirmed_at = NOW(),
       updated_at = NOW() WHERE id = ?`,
      req.user.id,
      payment.id,
    );
    const updated = await db.get('SELECT * FROM payments WHERE id = ?', payment.id);
    await notify(
      payment.manager_id,
      'payment.confirmed',
      'Платёж подтверждён',
      `${(payment.amount || 0).toLocaleString('ru-RU')} ${payment.currency || 'RUB'} зачислены в кассу`,
      '#/cashbox',
    );
    emitEvent('payment.confirmed', updated);
    res.json(updated);
  }),
);

router.post(
  '/:id/reject',
  requireRole('admin', 'finance'),
  asyncHandler(async (req, res) => {
    const reason = z.object({ reason: z.string().optional() }).parse(req.body || {}).reason;
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!payment) throw NotFound('Платёж не найден');
    if (payment.status !== 'pending') throw BadRequest('Этот платёж уже обработан');
    await db.run(
      `UPDATE payments SET status = 'rejected', rejection_reason = ?, confirmed_by = ?,
       confirmed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      reason ?? null,
      req.user.id,
      payment.id,
    );
    const updated = await db.get('SELECT * FROM payments WHERE id = ?', payment.id);
    await notify(
      payment.manager_id,
      'payment.rejected',
      'Платёж отклонён',
      reason || 'Без указания причины',
      '#/cashbox',
    );
    emitEvent('payment.rejected', updated);
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM payments WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Платёж не найден');
    res.status(204).send();
  }),
);

export default router;
