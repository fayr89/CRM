import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';
import { logAction } from '../services/audit.js';
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
    if (req.query.project_id) {
      where.push('o.project_id = ?');
      params.push(Number(req.query.project_id));
    }
    if (req.query.search) {
      const like = `%${req.query.search}%`;
      where.push('(o.shipment_qr ILIKE ? OR o.reference_number ILIKE ?)');
      params.push(like, like);
    }
    const scope = await paymentsScope(req.user, 'p.manager_id');
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT p.*, u.name AS manager_name, cu.name AS confirmer_name,
              o.reference_number AS order_reference, o.shipment_qr AS order_shipment_qr
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
      `SELECT COUNT(*)::int AS total FROM payments p LEFT JOIN orders o ON o.id = p.order_id ${whereSql}`,
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

    // Расход с комиссией → две транзакции (вывод + комиссия) в одной БД-транзакции.
    // Это списание со счёта в кассе: менеджер хочет вывести `amount`, банк/маркетплейс
    // удерживает `commission`, на руки получит `amount - commission`.
    if (data.kind === 'expense' && (data.commission || 0) > 0) {
      const payout = Math.round((data.amount - data.commission) * 100) / 100;
      if (payout <= 0) {
        throw BadRequest('Комиссия больше или равна сумме вывода');
      }
      const created = await db.withTransaction(async (tx) => {
        // 1) Основная транзакция «вывод» — на сумму к выводу (amount - commission).
        const parent = await tx.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, method, reference, notes, commission, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          req.user.id,
          data.order_id ?? null,
          payout,
          data.currency ?? 'RUB',
          data.method ?? null,
          data.reference ?? null,
          `Вывод${data.notes ? ' · ' + data.notes : ''}`,
          0,
          'expense',
        );
        // 2) Транзакция комиссии — со ссылкой parent_payment_id на вывод.
        await tx.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, method, reference, notes, commission, kind, parent_payment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          req.user.id,
          data.order_id ?? null,
          data.commission,
          data.currency ?? 'RUB',
          data.method ?? null,
          data.reference ?? null,
          `Комиссия к выводу #${parent.lastInsertRowid}`,
          0,
          'expense',
          parent.lastInsertRowid,
        );
        return parent.lastInsertRowid;
      });
      await logAction(req, {
        action: 'payment.created',
        entity_type: 'payment',
        entity_id: created,
        details: { kind: 'expense', payout, commission: data.commission, total: data.amount, split: true },
      });
      return res
        .status(201)
        .json(await db.get('SELECT * FROM payments WHERE id = ?', created));
    }

    // Обычный случай: одна транзакция (приход или расход без комиссии).
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
    await logAction(req, {
      action: 'payment.created',
      entity_type: 'payment',
      entity_id: result.lastInsertRowid,
      details: { order_id: data.order_id || null, amount: data.amount, kind: data.kind || 'income', method: data.method || null },
    });
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
    await logAction(req, { action: 'payment.updated', entity_type: 'payment', entity_id: payment.id, details: { fields: Object.keys(data) } });
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
    await logAction(req, { action: 'payment.confirmed', entity_type: 'payment', entity_id: payment.id, details: { amount: payment.amount, order_id: payment.order_id } });
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
    await logAction(req, { action: 'payment.rejected', entity_type: 'payment', entity_id: payment.id, details: { reason: reason || null } });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM payments WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Платёж не найден');
    await logAction(req, { action: 'payment.deleted', entity_type: 'payment', entity_id: Number(req.params.id) });
    res.status(204).send();
  }),
);

export default router;
