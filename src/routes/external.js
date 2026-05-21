import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { BadRequest, asyncHandler } from '../errors.js';
import { requireApiToken, requireScope } from '../middleware/apiToken.js';
import {
  notify,
  notifyAdminsAndManagers,
  notifyWarehouse,
} from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';

const router = Router();

router.use(requireApiToken);

router.get('/ping', (req, res) => {
  res.json({ ok: true, token: req.apiToken.name, scopes: req.apiToken.scopes });
});

const SOURCE_MAP = {
  website: 'website',
  site: 'website',
  form: 'website',
  landing: 'website',
  telegram: 'social',
  vk: 'social',
  whatsapp: 'social',
  social: 'social',
  ad: 'advertisement',
  ads: 'advertisement',
  yandex: 'advertisement',
  google: 'advertisement',
  referral: 'referral',
  event: 'event',
};

const leadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  estimated_value: z.number().nonnegative().optional().nullable(),
});

router.post(
  '/leads',
  requireScope('leads:create'),
  asyncHandler(async (req, res) => {
    const data = leadSchema.parse(req.body);
    const source = SOURCE_MAP[String(data.source || '').toLowerCase()] || 'other';
    const r = await db.run(
      `INSERT INTO leads
       (first_name, last_name, email, phone, company_name, position,
        source, description, estimated_value, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new') RETURNING id`,
      data.first_name,
      data.last_name ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.company_name ?? null,
      data.position ?? null,
      source,
      data.description ?? null,
      data.estimated_value ?? null,
    );
    const lead = await db.get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid);
    await notifyAdminsAndManagers(
      'lead.created',
      'Новый лид с внешнего источника',
      `${lead.first_name} ${lead.last_name || ''} · источник: ${data.source || 'другой'}`,
      '#/leads',
    );
    emitEvent('lead.created', lead);
    res.status(201).json({ id: lead.id, status: lead.status, lead });
  }),
);

const orderItemSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative().default(0),
});

const orderSchema = z.object({
  reference_number: z.string().optional().nullable(),
  marketplace: z.string().optional().nullable(),
  client_classification: z.string().optional().nullable(),
  client_name: z.string().optional().nullable(),
  currency: z.string().length(3).optional().default('RUB'),
  notes: z.string().optional().nullable(),
  items: z.array(orderItemSchema).min(1, 'В заказе должна быть хотя бы одна позиция'),
  manager_email: z.string().email().optional().nullable(),
});

async function pickManagerId(email) {
  if (email) {
    const m = await db.get(
      `SELECT id FROM users
       WHERE LOWER(email) = LOWER(?) AND role IN ('manager','sales','admin') AND active = TRUE`,
      email,
    );
    if (m) return m.id;
  }
  const m = await db.get(
    `SELECT id FROM users
     WHERE role = 'manager' AND active = TRUE ORDER BY id LIMIT 1`,
  );
  if (m) return m.id;
  const a = await db.get(
    `SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`,
  );
  return a?.id ?? null;
}

router.post(
  '/orders',
  requireScope('orders:create'),
  asyncHandler(async (req, res) => {
    const data = orderSchema.parse(req.body);
    const managerId = await pickManagerId(data.manager_email);
    if (!managerId) {
      throw BadRequest(
        'В CRM нет ни одного активного менеджера для приёма заказа. Создайте пользователя с ролью manager.',
      );
    }
    const totalAmount = data.items.reduce(
      (s, i) => s + i.quantity * i.unit_price,
      0,
    );
    const orderId = await db.withTransaction(async (tx) => {
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
        data.currency,
        managerId,
        data.notes ?? null,
      );
      const id = r.lastInsertRowid;
      for (const item of data.items) {
        await tx.run(
          `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          item.sku ?? null,
          item.name,
          item.quantity,
          item.unit_price,
          item.quantity * item.unit_price,
        );
      }
      return id;
    });

    const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
    const items = await db.all(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id',
      orderId,
    );
    const titleSrc = data.marketplace || data.reference_number || 'внешний источник';
    await notify(
      managerId,
      'order.created',
      `Новый заказ (${titleSrc})`,
      `${data.client_name || 'Клиент'} · ${totalAmount.toLocaleString('ru-RU')} ₽`,
      '#/orders',
    );
    await notifyWarehouse(
      'order.created',
      'Заказ ожидает резерва',
      `${data.client_name || data.reference_number || '#' + orderId} · ${totalAmount.toLocaleString('ru-RU')} ₽`,
      '#/orders',
    );
    emitEvent('order.created', { ...order, items });
    res.status(201).json({ id: orderId, status: order.status, order: { ...order, items } });
  }),
);

export default router;
