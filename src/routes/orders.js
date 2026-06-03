import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { notify, notifyWarehouse, buildOrderNotificationBody } from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';
import { toCsv, csvDate } from '../services/csv.js';
import { nextShippingDate, getSchedule } from '../services/shippingSchedule.js';
import { enqueueMsJob } from '../services/ms-jobs.js';
import { notifyAdmins } from '../services/notifications.js';
import { logAction } from '../services/audit.js';

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
  manager_note: z.string().optional().nullable(),
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
  manager_note: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1).optional(),
  ...pricingMeta,
});

// Реестр номеров отправления: каждый трек должен быть уникален среди
// активных заказов. Возвращает конфликтующую запись или null.
// Отменённые заказы не блокируют (трек можно использовать заново).
async function checkShipmentQrConflict(qr, excludeOrderId = null) {
  if (!qr || !String(qr).trim()) return null;
  const normalized = String(qr).trim();
  const where = ["TRIM(shipment_qr) = ?", "status != 'cancelled'"];
  const params = [normalized];
  if (excludeOrderId) {
    where.push('id != ?');
    params.push(Number(excludeOrderId));
  }
  return await db.get(
    `SELECT id, status, reference_number, client_name, marketplace, manager_id, created_at
     FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 1`,
    ...params,
  );
}

function shipmentQrConflictMessage(conflict) {
  const who = conflict.client_name || conflict.reference_number || ('заказ #' + conflict.id);
  const status = conflict.status || '—';
  return `Этот номер отправления уже используется в заказе #${conflict.id} (${who}, статус: ${status}). Если предыдущий заказ был отменён — обновите страницу. Если ошиблись — поправьте номер.`;
}

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
    if (req.query.direct === '1') {
      where.push('o.marketplace IS NULL');
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

    // ВАЖНО: в листинге НЕ отдаём return_proof (может содержать base64).
    // shipment_qr теперь только текст (трек-номер), поэтому отдаём — нужен в канбане.
    // ОПТИМИЗАЦИЯ: вместо 3 подзапросов на каждую строку (items_count + preview_image
    // + items_preview = 600 sub-queries на канбан в 200 строк) — один запрос за items
    // ниже + агрегация в JS. На холодной лямбде это десятки vs сотни мс.
    const rows = await db.all(
      `SELECT o.id, o.reference_number, o.marketplace, o.client_classification, o.client_name,
              o.total_amount, o.currency, o.manager_id, o.warehouse_user_id, o.status,
              o.notes, o.created_at, o.updated_at, o.reserved_at, o.shipped_at,
              o.completed_at, o.cancel_reason, o.cancelled_at, o.payment_method,
              o.price_deviation, o.recommended_total, o.delivery_method, o.client_phone,
              o.avito_dialog_url, o.return_status, o.return_resolved_by, o.return_resolved_at,
              o.warehouse, o.loss_voided, o.cancelled_from_status, o.parent_order_id,
              o.shipment_qr, o.manager_note,
              (o.shipment_qr IS NOT NULL AND o.shipment_qr <> '') AS has_qr,
              u.name AS manager_name, w.name AS warehouse_user_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       LEFT JOIN users w ON w.id = o.warehouse_user_id
       ${whereSql} ORDER BY o.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    // Подтягиваем items: один запрос для всех order_id, ROW_NUMBER для лимита 5 в preview.
    if (rows.length) {
      const orderIds = rows.map((r) => r.id);
      const itemsRows = await db.all(
        `SELECT order_id, name, sku, quantity, unit_price, image_url,
                ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id)::int AS rn,
                COUNT(*) OVER (PARTITION BY order_id)::int AS total_count
         FROM order_items
         WHERE order_id = ANY(?)
         ORDER BY order_id, rn`,
        orderIds,
      );
      const byOrder = new Map();
      for (const it of itemsRows) {
        let agg = byOrder.get(it.order_id);
        if (!agg) {
          agg = {
            items_count: it.total_count,
            preview_image: null,
            items_preview: [],
            first_item_sku: null,
            first_item_name: null,
            first_item_qty: null,
            first_item_price: null,
          };
          byOrder.set(it.order_id, agg);
        }
        if (!agg.preview_image && it.image_url) agg.preview_image = it.image_url;
        if (it.rn <= 5) agg.items_preview.push(it.name);
        if (it.rn === 1) {
          agg.first_item_sku = it.sku;
          agg.first_item_name = it.name;
          agg.first_item_qty = it.quantity;
          agg.first_item_price = it.unit_price;
        }
      }
      for (const r of rows) {
        const agg = byOrder.get(r.id) || {
          items_count: 0, preview_image: null, items_preview: [],
          first_item_sku: null, first_item_name: null, first_item_qty: null, first_item_price: null,
        };
        r.items_count = agg.items_count;
        r.preview_image = agg.preview_image;
        r.items_preview = agg.items_preview.join(', ');
        r.first_item_sku = agg.first_item_sku;
        r.first_item_name = agg.first_item_name;
        r.first_item_qty = agg.first_item_qty;
        r.first_item_price = agg.first_item_price;
      }
    }
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM orders o ${whereSql}`,
      ...params,
    );
    // Заметка для менеджера — склад не видит (защита и на бэке, не только в UI).
    if (req.user.role === 'warehouse') {
      for (const r of rows) r.manager_note = null;
    }
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

    // Порядковый номер в выгрузке — совпадает с номером на PDF-этикетке.
    orders.forEach((o, idx) => { o._seq = idx + 1; });
    // Способ отправки: предпочтительно delivery_method (СДЭК/Почта/Avito Доставка),
    // если пусто — marketplace. payment_method (cash/card) НЕ используется.
    const shipMethod = (row) => {
      const dm = String(row.delivery_method || '').trim().toLowerCase();
      const map = {
        sdek: 'СДЭК', cdek: 'СДЭК', pochta: 'Почта России', pochta_russia: 'Почта России',
        boxberry: 'Boxberry', yandex: 'Я.Доставка', avito_delivery: 'Avito Доставка',
        avito: 'Avito Доставка', pickup: 'Самовывоз', courier: 'Курьер',
      };
      if (dm) return map[dm] || row.delivery_method;
      const mp = String(row.marketplace || '').trim().toLowerCase();
      const mpMap = { avito: 'Avito', wildberries: 'Wildberries', wb: 'Wildberries', ozon: 'Ozon', yandex: 'Я.Маркет', yandex_market: 'Я.Маркет' };
      return mpMap[mp] || row.marketplace || '';
    };
    // Excel автоматически переводит длинные числа в научную нотацию ("8,05128E+13")
    // и срезает ведущие нули. Оборачиваем в формулу-строку ="...", тогда Excel
    // оставляет значение как текст.
    const asTextForExcel = (v) => {
      const s = String(v ?? '').trim();
      return s ? `="${s.replace(/"/g, '""')}"` : '';
    };

    const columns = [
      {
        key: 'sku',
        label: 'Артикул',
        get: (row) => {
          const list = itemsByOrder.get(row.id) || [];
          const skus = list.map((i) => i.sku || '').filter(Boolean);
          if (!skus.length) return '';
          // Каждый артикул как текст-формула, склеены через ' | '.
          return skus.map((s) => `="${s.replace(/"/g, '""')}"`).join(' | ');
        },
      },
      {
        key: 'qty',
        label: 'Кол-во',
        get: (row) => {
          const list = itemsByOrder.get(row.id) || [];
          return list.map((i) => String(i.quantity)).join(' | ');
        },
      },
      {
        key: 'items',
        label: 'Наименование',
        get: (row) => {
          const list = itemsByOrder.get(row.id) || [];
          return list.map((i) => i.name).join(' | ');
        },
      },
      { key: 'ship_method', label: 'Способ отправки', get: shipMethod },
      { key: 'shipment_qr', label: 'Трек номер', format: asTextForExcel },
      { key: 'manager_name', label: 'Менеджер' },
      { key: '_seq', label: '№', format: (v) => String(v) },
      { key: 'id', label: 'ID', format: (v) => `#${v}` },
      { key: 'notes', label: 'Комментарий' },
    ];

    const csv = toCsv(orders, columns);
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }),
);

// PDF с этикетками отгрузки: на каждый заказ страница 58×40мм со штрих-кодом
// Code 128 (из shipment_qr), порядковым номером и службой доставки.
// Query params: ?ids=N,N,N (или фильтры как у /export.csv, по умолчанию reserved).
router.get(
  '/labels.pdf',
  asyncHandler(async (req, res) => {
    const idsRaw = String(req.query.ids || '').trim();
    let orders;
    if (idsRaw) {
      const ids = idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (!ids.length) throw BadRequest('Некорректный параметр ids');
      orders = await db.all(
        `SELECT o.id, o.reference_number, o.shipment_qr, o.delivery_method, o.payment_method,
                o.marketplace, u.name AS manager_name
         FROM orders o LEFT JOIN users u ON u.id = o.manager_id
         WHERE o.id = ANY(?) ORDER BY array_position(?::int[], o.id)`,
        ids,
        ids,
      );
    } else {
      // По умолчанию — все reserved (для массовой печати в графике отгрузок).
      const scope = await orderScope(req.user);
      const where = ['o.status = ?'];
      const params = ['reserved'];
      if (scope.sql) {
        where.push(scope.sql.replace(/manager_id/g, 'o.manager_id'));
        params.push(...scope.params);
      }
      orders = await db.all(
        `SELECT o.id, o.reference_number, o.shipment_qr, o.delivery_method, o.payment_method,
                o.marketplace, u.name AS manager_name
         FROM orders o LEFT JOIN users u ON u.id = o.manager_id
         WHERE ${where.join(' AND ')} ORDER BY o.reserved_at`,
        ...params,
      );
    }
    if (!orders.length) throw BadRequest('Не найдено заказов для печати этикеток');
    // Загружаем позиции заказов.
    const orderIds = orders.map((o) => o.id);
    const itemRows = await db.all(
      `SELECT order_id, sku, name, quantity FROM order_items WHERE order_id = ANY(?) ORDER BY order_id, id`,
      orderIds,
    );
    const itemsByOrder = {};
    for (const it of itemRows) {
      if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
      itemsByOrder[it.order_id].push(it);
    }
    for (const o of orders) o.items = itemsByOrder[o.id] || [];
    // shipment_qr — обязательное поле этикетки. Если у кого-то пусто — пропускаем (внутри).
    const { generateLabelsPdf } = await import('../services/labels-pdf.js');
    const pdf = await generateLabelsPdf(orders);
    const filename = `labels-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }),
);

// Лист сборки/проверки заказов: CSV с детализацией по позициям (одна строка = одна позиция).
// По умолчанию — зарезервированные заказы (статус reserved). Query: ?status=, ?ids=N,N
router.get(
  '/assembly-list.csv',
  asyncHandler(async (req, res) => {
    const scope = await orderScope(req.user);
    const where = [];
    const params = [];
    const idsRaw = String(req.query.ids || '').trim();
    if (idsRaw) {
      const ids = idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (!ids.length) throw BadRequest('Некорректный параметр ids');
      where.push('o.id = ANY(?)');
      params.push(ids);
    } else {
      where.push('o.status = ?');
      params.push(req.query.status || 'reserved');
    }
    if (scope.sql) {
      where.push(scope.sql.replace(/manager_id/g, 'o.manager_id'));
      params.push(...scope.params);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const orders = await db.all(
      `SELECT o.id, o.reference_number, o.client_name, o.marketplace, o.delivery_method,
              o.shipment_qr, o.warehouse, o.notes, o.reserved_at, o.created_at,
              u.name AS manager_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       ${whereSql} ORDER BY o.reserved_at NULLS LAST, o.id`,
      ...params,
    );
    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await db.all(
          `SELECT order_id, sku, name, quantity FROM order_items
           WHERE order_id = ANY(?) ORDER BY order_id, id`,
          orderIds,
        )
      : [];
    const itemsByOrder = new Map();
    for (const it of items) {
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id).push(it);
    }
    // Одна строка = одна позиция заказа. Заголовок повторяется один раз.
    const BOM = '﻿';
    const header = ['№ п/п', 'ID заказа', 'Внешний №', 'Клиент', 'Маркетплейс',
      'Способ доставки', 'Трек номер', 'Склад', 'Артикул', 'Наименование', 'Кол-во',
      'Менеджер', 'Комментарий'];
    const escape = (v) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const shipMethodStr = (o) => {
      const dm = String(o.delivery_method || '').trim().toLowerCase();
      const map = { sdek: 'СДЭК', cdek: 'СДЭК', pochta: 'Почта России', pochta_russia: 'Почта России',
        boxberry: 'Boxberry', yandex: 'Я.Доставка', avito_delivery: 'Avito Доставка',
        avito: 'Avito Доставка', pickup: 'Самовывоз', courier: 'Курьер' };
      if (dm) return map[dm] || o.delivery_method;
      return o.marketplace || '';
    };
    const rows = [header.map(escape).join(',')];
    let seq = 0;
    for (const o of orders) {
      const orderItems = itemsByOrder.get(o.id) || [{ sku: '', name: '—', quantity: '' }];
      for (const it of orderItems) {
        seq++;
        rows.push([
          seq, o.id, o.reference_number || '', o.client_name || '',
          o.marketplace || '', shipMethodStr(o), o.shipment_qr || '',
          o.warehouse || '', it.sku || '', it.name || '', it.quantity ?? '',
          o.manager_name || '', o.notes || '',
        ].map(escape).join(','));
      }
    }
    const csv = BOM + rows.join('\r\n');
    const filename = `assembly-${new Date().toISOString().slice(0, 10)}.csv`;
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

// Автоподсказка клиентов из истории заказов — для формы создания заказа.
// Подбор по фрагменту имени или телефона. Видимость ограничена правами:
// admin/finance видят всех клиентов, остальные — только из своих заказов.
// Проверка трека на дубль — для live-валидации в форме при наборе.
router.get(
  '/check-shipment-qr',
  asyncHandler(async (req, res) => {
    const qr = String(req.query.qr || '').trim();
    const excludeId = req.query.exclude_id ? Number(req.query.exclude_id) : null;
    if (!qr) return res.json({ ok: true });
    const conflict = await checkShipmentQrConflict(qr, excludeId);
    if (conflict) {
      res.json({ ok: false, conflict, message: shipmentQrConflictMessage(conflict) });
    } else {
      res.json({ ok: true });
    }
  }),
);

router.get(
  '/clients/suggest',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ data: [] });
    const ids = await getAccessibleUserIds(req.user);
    const scopeSql = ids === null ? '' : 'AND manager_id = ANY(?)';
    const scopeParams = ids === null ? [] : [ids];
    const like = `%${q}%`;
    // GROUP BY (LOWER(name), phone) — один клиент = одна строка. ARRAY_AGG с
    // ORDER BY даёт значения из последнего заказа этого клиента (классификация,
    // площадка). Свежие клиенты сверху.
    const rows = await db.all(
      `SELECT MAX(client_name) AS client_name,
              client_phone,
              (ARRAY_AGG(client_classification ORDER BY created_at DESC))[1] AS client_classification,
              (ARRAY_AGG(marketplace ORDER BY created_at DESC))[1] AS marketplace,
              MAX(created_at) AS last_at,
              COUNT(*)::int AS count
       FROM orders
       WHERE client_name IS NOT NULL
         AND (client_name ILIKE ? OR COALESCE(client_phone, '') ILIKE ?)
         ${scopeSql}
       GROUP BY LOWER(client_name), client_phone
       ORDER BY MAX(created_at) DESC
       LIMIT 10`,
      like, like,
      ...scopeParams,
    );
    res.json({ data: rows });
  }),
);

// Последние товары, которые этот клиент уже заказывал. Для формы создания
// заказа: после выбора клиента из истории показываем плитки с его прошлыми
// позициями (можно ткнуть и сразу добавить). Сопоставление — по точному имени
// + телефону (то, что есть в orders). Только не-отменённые заказы.
router.get(
  '/clients/recent-items',
  asyncHandler(async (req, res) => {
    const name = String(req.query.name || '').trim();
    const phone = String(req.query.phone || '').trim();
    if (!name && !phone) return res.json({ data: [] });
    const ids = await getAccessibleUserIds(req.user);
    const scopeSql = ids === null ? '' : 'AND o.manager_id = ANY(?)';
    const scopeParams = ids === null ? [] : [ids];
    const marketplace = String(req.query.marketplace || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    const rows = await db.all(
      `WITH client_items AS (
         SELECT oi.product_id, MAX(o.created_at) AS last_ordered_at, SUM(oi.quantity)::int AS total_qty
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id IS NOT NULL
           AND o.status != 'cancelled'
           AND (
             (? <> '' AND LOWER(o.client_name) = LOWER(?))
             OR (? <> '' AND o.client_phone = ?)
           )
           ${scopeSql}
         GROUP BY oi.product_id
         ORDER BY MAX(o.created_at) DESC
         LIMIT 12
       )
       SELECT ci.product_id,
              COALESCE(p.name, oi_last.name) AS name,
              COALESCE(p.sku, oi_last.sku) AS sku,
              p.image_url, p.stock_by_store, p.stock, p.cost_price,
              pp.price AS marketplace_price,
              ci.last_ordered_at, ci.total_qty
       FROM client_items ci
       LEFT JOIN products p ON p.id = ci.product_id
       LEFT JOIN product_prices pp ON pp.product_id = ci.product_id
              AND pp.marketplace = ? AND pp.warehouse = ?
       LEFT JOIN LATERAL (
         SELECT oi2.name, oi2.sku FROM order_items oi2
         JOIN orders o2 ON o2.id = oi2.order_id
         WHERE oi2.product_id = ci.product_id
         ORDER BY o2.created_at DESC LIMIT 1
       ) oi_last ON TRUE
       ORDER BY ci.last_ordered_at DESC`,
      name, name,
      phone, phone,
      ...scopeParams,
      marketplace, warehouse,
    );
    res.json({ data: rows });
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
  resolution: z.enum(['restocked', 'written_off', 'lost', 'markdown']),
  proof: z.string().optional().nullable(), // base64-фото
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
    if (resolution === 'markdown' && !proof) {
      throw BadRequest('Для уценки приложите фото-пруф состояния товара');
    }
    await db.run(
      `UPDATE orders SET return_status = ?, return_proof = ?, return_resolved_by = ?,
       return_resolved_at = NOW(), updated_at = NOW() WHERE id = ?`,
      resolution,
      (resolution === 'written_off' || resolution === 'markdown') ? proof : null,
      req.user.id,
      order.id,
    );
    // МС: товар вернулся → «Возврат от покупателя» (приход); потерян/брак →
    // «Списание»; уценка → новый товар + возврат на склад уценки + задача админу.
    if (resolution === 'restocked') {
      await enqueueMsJob(order.id, 'customerreturn.create');
    } else if (resolution === 'written_off' || resolution === 'lost') {
      await enqueueMsJob(order.id, 'loss.create');
    } else if (resolution === 'markdown') {
      await handleMarkdownResolution(order);
    }
    await logAction(req, { action: 'order.return_resolved', entity_type: 'order', entity_id: order.id, details: { resolution } });
    res.json(await db.get('SELECT * FROM orders WHERE id = ?', order.id));
  }),
);

// Уценка: для каждой позиции заказа создаём новый товар-уценку в CRM (своя цена,
// своя единица), ставим задачу в МС (создать там товар, customerreturn на склад
// уценки) и уведомляем админов — нужно проставить цену для новых уценок.
async function handleMarkdownResolution(order) {
  const items = await db.all(
    `SELECT oi.id AS item_id, oi.name, oi.quantity, oi.unit_price, oi.product_id,
            p.sku AS orig_sku, p.cost_price, p.supplier, p.image_url, p.external_id AS ms_orig_id
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`,
    order.id,
  );
  const markdownIds = [];
  // Стотик уценочного склада — тот же что использует markdownCreateHandler в МС.
  // Заполняем stock_by_store сразу при создании, чтобы каталог отобразил остаток
  // без ожидания импорта остатков из МС (МС лагает между POST product и появлением
  // в /report/stock/bystore; импорт может пройти и не увидеть товар).
  const MARKDOWN_STORE = 'Склад МСК (Электросталь) УЦЕНКА';
  for (const it of items) {
    if (!it.product_id) continue; // позиция без привязки — пропускаем
    const sku = it.orig_sku ? `${it.orig_sku}-MD-${order.id}-${it.item_id}` : `MD-${order.id}-${it.item_id}`;
    const name = `${it.name} (УЦЕНКА #${order.id})`;
    const stockByStore = JSON.stringify([{ store: MARKDOWN_STORE, stock: it.quantity, reserve: 0 }]);
    const r = await db.run(
      `INSERT INTO products
       (sku, name, cost_price, supplier, image_url, stock, stock_by_store, active,
        is_markdown, markdown_of_product_id, markdown_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, TRUE, TRUE, ?, ?) RETURNING id`,
      sku,
      name,
      it.cost_price ?? 0,
      it.supplier ?? null,
      it.image_url ?? null,
      it.quantity,
      stockByStore,
      it.product_id,
      order.id,
    );
    markdownIds.push(r.lastInsertRowid);
  }
  if (markdownIds.length) {
    await enqueueMsJob(order.id, 'markdown.create', { markdown_product_ids: markdownIds });
    await notifyAdmins(
      'product.markdown',
      `🏷️ Уценка: проставьте цену`,
      `Заказ #${order.id}: ${markdownIds.length} уценённых товар(ов) ждут цены в каталоге.`,
      '#/products?markdown=1',
    );
  }
}

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
    await logAction(req, { action: 'order.loss_voided', entity_type: 'order', entity_id: order.id });
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
    // Заметка для менеджера — склад не видит.
    if (req.user.role === 'warehouse') order.manager_note = null;
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
    // Реестр треков: один и тот же shipment_qr не должен быть на двух активных заказах.
    if (data.shipment_qr) {
      const conflict = await checkShipmentQrConflict(data.shipment_qr);
      if (conflict) throw BadRequest(shipmentQrConflictMessage(conflict));
    }
    const totalAmount = data.items.reduce(
      (sum, i) => sum + i.quantity * i.unit_price,
      0,
    );

    const newId = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO orders
         (reference_number, marketplace, client_classification, client_name,
          total_amount, currency, manager_id, notes, manager_note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        data.reference_number ?? null,
        data.marketplace ?? null,
        data.client_classification ?? null,
        data.client_name ?? null,
        totalAmount,
        data.currency ?? 'RUB',
        req.user.id,
        data.notes ?? null,
        data.manager_note ?? null,
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
    // Тело уведомления (сумма + менеджер + клиент + состав) — общее для админов
    // и склада. Админу важно видеть чужие заказы менеджеров с полной картиной.
    const body = await buildOrderNotificationBody(newId);
    await notifyAdmins(
      'order.created',
      `🆕 Новый заказ #${newId}`,
      body,
      `#/orders?id=${newId}`,
    );
    await notifyWarehouse(
      'order.created',
      'Новый заказ ожидает резерва',
      body,
      `#/orders?id=${newId}`,
    );
    emitEvent('order.created', { ...order, items });
    await logAction(req, { action: 'order.created', entity_type: 'order', entity_id: newId, details: { marketplace: order.marketplace, status: order.status, total: order.total_amount } });
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
    if (order.status !== 'new') {
      if (req.user.role !== 'admin') {
        throw BadRequest('Менять заказ можно только пока он в статусе «новый»');
      }
      // Админ может править «безопасные» поля (notes, manager_note, client_name,
      // delivery_method и т.п.) даже когда заказ зарезервирован/отгружен.
      // Запрещаем менять то, что повлияет на резервы в МС, кассу и склад:
      //   items, warehouse, payment_method.
      // Если действительно нужно поменять — сначала «↩️ Снять резерв».
      if (data.items) {
        const existing = await db.all(
          `SELECT sku, name, quantity, unit_price, product_id
           FROM order_items WHERE order_id = ? ORDER BY id`,
          order.id,
        );
        const norm = (it) =>
          `${(it.sku || '').trim()}|${it.name}|${Number(it.quantity)}|${Number(it.unit_price)}|${it.product_id || ''}`;
        const same = existing.length === data.items.length
          && existing.map(norm).join('\n') === data.items.map(norm).join('\n');
        if (!same) {
          throw BadRequest(
            `Состав заказа нельзя менять в статусе «${order.status}» — иначе резервы в МойСклад разъедутся. ` +
            'Сначала «↩️ Снять резерв», потом редактируйте позиции.',
          );
        }
        // Состав не изменился — позиции не перезаписываем (экономим запросы и
        // не дёргаем zero-diff DELETE+INSERT).
        delete data.items;
      }
      if (data.warehouse !== undefined && (data.warehouse || '') !== (order.warehouse || '')) {
        throw BadRequest(
          `Склад списания нельзя менять в статусе «${order.status}» — сначала «↩️ Снять резерв».`,
        );
      }
      if (data.payment_method !== undefined && (data.payment_method || '') !== (order.payment_method || '')) {
        throw BadRequest(
          `Способ оплаты нельзя менять в статусе «${order.status}» — сначала «↩️ Снять резерв» ` +
          '(это поле влияет на pending-транзакцию в кассе).',
        );
      }
    }
    // Реестр треков: тот же qr на другом активном заказе — запрещаем.
    if (data.shipment_qr) {
      const conflict = await checkShipmentQrConflict(data.shipment_qr, order.id);
      if (conflict) throw BadRequest(shipmentQrConflictMessage(conflict));
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
        'manager_note',
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
    await logAction(req, { action: 'order.updated', entity_type: 'order', entity_id: order.id, details: { fields: Object.keys(data) } });
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
    // Проверка остатков на складе списания: available = stock − reserve.
    // Позиции без product_id (ручные) пропускаем — учёт по ним не ведём.
    // Если хоть одна позиция превышает доступное — возвращаем 400 со списком,
    // менеджер увидит конкретные товары и корректирует или ждёт прихода.
    // Админ/склад могут передать ?force=1 чтобы зарезервировать в обход (срочно).
    const force = req.query.force === '1' && ['admin', 'warehouse'].includes(req.user.role);
    if (!force) {
      const items = await db.all(
        `SELECT oi.id, oi.name, oi.quantity, oi.product_id, oi.sku, p.stock_by_store
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ?`,
        order.id,
      );
      const wh = (order.warehouse || '').trim();
      const issues = [];
      for (const it of items) {
        if (!it.product_id) continue;
        if (!wh) {
          issues.push({ name: it.name, sku: it.sku, qty: it.quantity, available: 0, reason: 'не задан склад списания' });
          continue;
        }
        const sbs = Array.isArray(it.stock_by_store) ? it.stock_by_store
          : (typeof it.stock_by_store === 'string' ? JSON.parse(it.stock_by_store || '[]') : []);
        const row = sbs.find((e) => String(e.store || '').trim() === wh);
        const stock = Number(row?.stock) || 0;
        const reserve = Number(row?.reserve) || 0;
        const available = Math.max(0, stock - reserve);
        if (it.quantity > available) {
          issues.push({ name: it.name, sku: it.sku, qty: it.quantity, available });
        }
      }
      if (issues.length) {
        const lines = issues.map((i) =>
          `• ${i.name}${i.sku ? ' (' + i.sku + ')' : ''}: нужно ${i.qty}, доступно ${i.available}${i.reason ? ' — ' + i.reason : ''}`,
        ).join('\n');
        throw BadRequest(
          `Недостаточно товара на складе «${wh || '—'}»:\n${lines}\n\n` +
          (['admin', 'warehouse'].includes(req.user.role)
            ? 'Если уверены — нажмите «Зарезервировать всё равно».'
            : 'Обратитесь к складу или дождитесь поставки.'),
        );
      }
    }
    // Смена статуса + создание кассового прихода — в одной БД-транзакции, чтобы
    // не было рассинхрона: либо заказ зарезервирован И транзакция создана, либо ничего.
    await db.withTransaction(async (tx) => {
      await tx.run(
        `UPDATE orders SET status = 'reserved', warehouse_user_id = ?,
         reserved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        req.user.id,
        order.id,
      );
      const existing = await tx.get('SELECT id FROM payments WHERE order_id = ?', order.id);
      if (!existing && (order.total_amount || 0) > 0) {
        await tx.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'income', 'pending', ?, NOW(), NOW())`,
          order.manager_id,
          order.id,
          order.total_amount,
          order.currency || 'RUB',
          `Заказ #${order.id}${order.marketplace ? ' · ' + order.marketplace : ''}`,
        );
      }
    });
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // МС: ставим/обновляем customerorder с резервом на позициях.
    await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'full' });
    const reservedBody = await buildOrderNotificationBody(order.id);
    await notify(
      order.manager_id,
      'order.reserved',
      'Заказ зарезервирован',
      reservedBody + '\n\n✅ Склад готов отгружать',
      `#/orders?id=${order.id}`,
    );
    await notifyAdmins(
      'order.reserved',
      `✅ Заказ #${order.id} зарезервирован`,
      reservedBody,
      `#/orders?id=${order.id}`,
    );
    emitEvent('order.reserved', updated);
    await logAction(req, { action: 'order.reserved', entity_type: 'order', entity_id: order.id });
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
    // МС: создаём документ «Отгрузка» — остатки в МС физически списываются.
    await enqueueMsJob(order.id, 'demand.create');
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    const shippedBody = await buildOrderNotificationBody(order.id);
    await notify(
      order.manager_id,
      'order.shipped',
      'Заказ отгружен',
      shippedBody + '\n\n📦 Можно завершать',
      `#/orders?id=${order.id}`,
    );
    await notifyAdmins(
      'order.shipped',
      `📦 Заказ #${order.id} отгружен`,
      shippedBody,
      `#/orders?id=${order.id}`,
    );
    emitEvent('order.shipped', updated);
    await logAction(req, { action: 'order.shipped', entity_type: 'order', entity_id: order.id });
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
    // МС: документ «Отгрузка» на каждый — остаток списывается.
    for (const oid of shippedIds) {
      await enqueueMsJob(oid, 'demand.create').catch((e) =>
        console.error(`[ms] enqueue demand.create #${oid}:`, e.message),
      );
    }
    // Уведомляем менеджеров каждого заказа.
    for (const order of orders) {
      const body = await buildOrderNotificationBody(order.id);
      await notify(
        order.manager_id,
        'order.shipped',
        'Заказ отгружен',
        body + '\n\n📦 Можно завершать',
        `#/orders?id=${order.id}`,
      );
      await notifyAdmins(
        'order.shipped',
        `📦 Заказ #${order.id} отгружен`,
        body,
        `#/orders?id=${order.id}`,
      );
      emitEvent('order.shipped', { ...order, status: 'shipped' });
      await logAction(req, { action: 'order.shipped', entity_type: 'order', entity_id: order.id, details: { bulk: true } });
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
    await logAction(req, { action: 'order.completed', entity_type: 'order', entity_id: order.id });
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
    // Смена статуса + компенсирующая кассовая транзакция — в одной БД-транзакции.
    await db.withTransaction(async (tx) => {
      await tx.run(
        `UPDATE orders SET status = 'cancelled', cancel_reason = ?,
         return_status = ?, cancelled_from_status = ?, cancelled_at = NOW(), updated_at = NOW() WHERE id = ?`,
        reason ?? null,
        needsReturn ? 'pending' : null,
        order.status,
        order.id,
      );
      const income = await tx.get(
        `SELECT * FROM payments WHERE order_id = ? AND kind = 'income' ORDER BY id DESC LIMIT 1`,
        order.id,
      );
      if (income) {
        const alreadyReversed = await tx.get(
          `SELECT id FROM payments WHERE order_id = ? AND kind = 'expense'`,
          order.id,
        );
        if (!alreadyReversed) {
          await tx.run(
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
    });
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // МС: если был резерв (был зарезервирован/отгружён) — снимаем резерв в customerorder.
    // Для new/waiting_stock — customerorder в МС обычно ещё нет, поэтому пропускаем.
    if (['reserved', 'shipped'].includes(order.status)) {
      await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    }
    emitEvent('order.cancelled', updated);
    await logAction(req, { action: 'order.cancelled', entity_type: 'order', entity_id: order.id, details: { reason, from_status: order.status } });
    res.json(updated);
  }),
);

// Снять резерв: reserved → new. Удаляет pending-приход из кассы (это была заготовка
// под подтверждение), снимает резерв в МС. Подтверждённую транзакцию оставляет —
// её менеджер должен обработать сам (отклонить или вручную решить).
router.post(
  '/:id/unreserve',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    const isAdminOrWarehouse = ['admin', 'warehouse'].includes(req.user.role);
    if (!isAdminOrWarehouse && !(await canAccessOrder(req.user, order))) throw Forbidden();
    if (order.status !== 'reserved') {
      throw BadRequest('Снять резерв можно только с зарезервированного заказа');
    }
    await db.withTransaction(async (tx) => {
      await tx.run(
        `UPDATE orders SET status = 'new', warehouse_user_id = NULL,
         reserved_at = NULL, updated_at = NOW() WHERE id = ?`,
        order.id,
      );
      // Удаляем pending-приход (создан при резерве, не подтверждён — реальных денег нет).
      await tx.run(
        `DELETE FROM payments WHERE order_id = ? AND kind = 'income' AND status = 'pending'`,
        order.id,
      );
    });
    // МС: снимаем резерв в customerorder (reserve = 0 на позициях).
    await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    await logAction(req, { action: 'order.unreserved', entity_type: 'order', entity_id: order.id });
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
    const prevStatus = order.status;
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
    // МС: если переходим из reserved — снимаем резерв в customerorder.
    if (prevStatus === 'reserved') {
      await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    }
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    await logAction(req, { action: 'order.mark_waiting', entity_type: 'order', entity_id: order.id, details: { from_status: prevStatus } });
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
    // МС: удаляем документ «Отгрузка» — остатки возвращаются, customerorder остаётся.
    await enqueueMsJob(order.id, 'demand.delete');
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updated);
    await logAction(req, { action: 'order.unshipped', entity_type: 'order', entity_id: order.id });
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
    await logAction(req, { action: 'order.mark_ready', entity_type: 'order', entity_id: order.id });
    res.json(updated);
  }),
);

// Разделить заказ: отделить часть позиций (можно с указанием количества) в новый заказ.
// Если quantity = item.quantity — переносим строку целиком. Если меньше — расщепляем
// позицию на две строки: оставшаяся уменьшается, новая создаётся в новом заказе.
// Нельзя отделить ВСЁ: в исходном должна остаться хотя бы одна позиция с qty > 0.
async function performSplit({ original, items, newStatus }) {
  const allItems = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', original.id);
  if (!allItems.length) throw BadRequest('У заказа нет позиций');
  const allMap = new Map(allItems.map((i) => [i.id, i]));

  for (const m of items) {
    const it = allMap.get(m.item_id);
    if (!it) throw BadRequest('Какая-то из выбранных позиций не принадлежит этому заказу');
    if (m.quantity <= 0) throw BadRequest(`Количество для «${it.name}» должно быть больше 0`);
    if (m.quantity > it.quantity) {
      throw BadRequest(`По позиции «${it.name}» доступно только ${it.quantity} шт, а указано ${m.quantity}`);
    }
  }

  // Сколько позиций ОСТАНЕТСЯ с qty>0 в исходном после переноса.
  const movesByItemId = new Map(items.map((m) => [m.item_id, m.quantity]));
  const remainingRowsCount = allItems.filter((it) => {
    const mv = movesByItemId.get(it.id);
    return !mv || mv < it.quantity;
  }).length;
  if (remainingRowsCount === 0) {
    throw BadRequest('Нельзя отделить всё — оставьте хотя бы одну позицию в исходном заказе');
  }

  // Итог по сумме (по unit_price × quantity).
  let movingTotal = 0;
  for (const m of items) {
    const it = allMap.get(m.item_id);
    movingTotal += (it.unit_price || 0) * m.quantity;
  }
  const allTotal = allItems.reduce((s, i) => s + (i.line_total || 0), 0);
  const remainingTotal = allTotal - movingTotal;

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

    for (const m of items) {
      const it = allMap.get(m.item_id);
      if (m.quantity === it.quantity) {
        // Переносим строку целиком.
        await tx.run('UPDATE order_items SET order_id = ? WHERE id = ?', splitId, it.id);
      } else {
        // Расщепляем: в исходном остаётся (qty - moved), создаём новую строку в новом заказе.
        const remainingQty = it.quantity - m.quantity;
        const remainingLine = (it.unit_price || 0) * remainingQty;
        const movedLine = (it.unit_price || 0) * m.quantity;
        await tx.run(
          'UPDATE order_items SET quantity = ?, line_total = ? WHERE id = ?',
          remainingQty,
          remainingLine,
          it.id,
        );
        await tx.run(
          `INSERT INTO order_items
           (order_id, sku, name, quantity, unit_price, line_total, product_id, image_url, catalog_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          splitId,
          it.sku ?? null,
          it.name,
          m.quantity,
          it.unit_price || 0,
          movedLine,
          it.product_id ?? null,
          it.image_url ?? null,
          it.catalog_price ?? null,
        );
      }
    }

    const noteAppend = `Разделён → создан заказ #${splitId}`;
    const newNotes = original.notes ? `${original.notes}\n${noteAppend}` : noteAppend;
    await tx.run('UPDATE orders SET total_amount = ?, notes = ?, updated_at = NOW() WHERE id = ?', remainingTotal, newNotes, original.id);
    return splitId;
  });
}

const splitSchema = z.object({
  items: z.array(z.object({
    item_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  })).min(1),
  new_status: z.enum(['new', 'waiting_stock']).optional().default('new'),
});
router.post(
  '/:id/split',
  asyncHandler(async (req, res) => {
    const { items, new_status } = splitSchema.parse(req.body || {});
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (!(await canAccessOrder(req.user, order))) throw Forbidden();
    if (!['new', 'reserved'].includes(order.status)) {
      throw BadRequest('Разделять можно только новый или зарезервированный заказ');
    }
    const newId = await performSplit({ original: order, items, newStatus: new_status });

    const newOrder = await db.get('SELECT * FROM orders WHERE id = ?', newId);
    const newItems = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', newId);
    const updatedOriginal = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    emitEvent('order.updated', updatedOriginal);
    emitEvent('order.created', { ...newOrder, items: newItems });
    await logAction(req, { action: 'order.split', entity_type: 'order', entity_id: order.id, details: { new_order_id: newId, new_status: new_status, items: items.length } });
    res.status(201).json({ new_order: { ...newOrder, items: newItems }, original: updatedOriginal });
  }),
);

// Действие над отдельной позицией (с опциональным quantity): «Ждём товара» (отделить
// в waiting_stock) или «Отменить» (отделить + сразу отменить). Если quantity не задан —
// переносим всю позицию целиком.
const extractSchema = z.object({
  action: z.enum(['waiting', 'cancel']),
  reason: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional(),
});
router.post(
  '/:id/items/:itemId/extract',
  asyncHandler(async (req, res) => {
    const { action, reason, quantity } = extractSchema.parse(req.body || {});
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

    const qty = quantity ?? item.quantity;
    const newStatus = action === 'waiting' ? 'waiting_stock' : order.status;
    const splitId = await performSplit({
      original: order,
      items: [{ item_id: itemId, quantity: qty }],
      newStatus,
    });

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
    await logAction(req, {
      action: action === 'cancel' ? 'order.item_cancelled' : 'order.item_waiting',
      entity_type: 'order',
      entity_id: order.id,
      details: { new_order_id: splitId, item_id: itemId, quantity: qty, reason: reason || null },
    });
    res.status(201).json({ new_order: { ...newOrder, items: newItems }, original: updatedOriginal });
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM orders WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Заказ не найден');
    await logAction(req, { action: 'order.deleted', entity_type: 'order', entity_id: Number(req.params.id) });
    res.status(204).send();
  }),
);

// --- Импорт заказов из CSV ---

function parseCsvRow(line, sep) {
  const cols = [];
  let cur = '';
  let inq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inq) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inq = false;
      else cur += c;
    } else if (c === '"') {
      inq = true;
    } else if (c === sep) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function detectSep(header) {
  return (header.match(/;/g) || []).length >= (header.match(/,/g) || []).length ? ';' : ',';
}

// GET /api/orders/import-template.csv — шаблон для импорта
router.get(
  '/import-template.csv',
  asyncHandler(async (_req, res) => {
    const bom = '﻿';
    const header = 'Артикул;Наименование;Кол-во;Цена за штуку;Сумма;Способ доставки;Трек-номер;Способ оплаты';
    const example = '12345678;Товар пример;1;999;999;Авито Доставка;60912345678;Авито Доставка';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-import-template.csv"');
    res.send(bom + header + '\r\n' + example + '\r\n');
  }),
);

const importBodySchema = z.object({
  csv: z.string().min(1),
  dry_run: z.boolean().optional().default(true),
  warehouse: z.string().optional().nullable(),
});

// POST /api/orders/import — разбор CSV и создание заказов
router.post(
  '/import',
  requireRole('admin', 'manager', 'sales'),
  asyncHandler(async (req, res) => {
    const { csv, dry_run, warehouse } = importBodySchema.parse(req.body || {});
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw BadRequest('Файл пуст');

    const sep = detectSep(lines[0]);
    const headerRaw = parseCsvRow(lines[0], sep).map((h) => h.toLowerCase().replace(/ё/g, 'е'));
    const colIdx = (names) => {
      for (const n of names) {
        const i = headerRaw.findIndex((h) => h.includes(n));
        if (i !== -1) return i;
      }
      return -1;
    };
    const iSku = colIdx(['артикул', 'sku', 'artic']);
    const iName = colIdx(['наименование', 'название', 'name', 'товар']);
    const iQty = colIdx(['кол-во', 'количество', 'qty', 'кол']);
    const iPrice = colIdx(['цена за', 'цена/шт', 'цена', 'price', 'unit']);
    const iDelivery = colIdx(['способ доставки', 'доставка', 'delivery', 'служба']);
    const iTrack = colIdx(['трек', 'track', 'отправление', 'shipment']);
    const iPayment = colIdx(['оплата', 'payment', 'pay']);

    if (iSku === -1 || iName === -1 || iQty === -1 || iPrice === -1) {
      throw BadRequest('Не найдены обязательные колонки: Артикул, Наименование, Кол-во, Цена за штуку. Скачайте шаблон.');
    }

    const groups = new Map(); // track → [{sku,name,qty,price,delivery,payment}]
    const errors = [];

    for (let li = 1; li < lines.length; li++) {
      const cols = parseCsvRow(lines[li], sep);
      const sku = (iSku !== -1 ? cols[iSku] : '').replace(/^=?"?|"?$/g, '').trim();
      const name = (iName !== -1 ? cols[iName] : '').trim();
      const qty = parseInt((iQty !== -1 ? cols[iQty] : '0').replace(/[^0-9]/g, '')) || 0;
      const price = parseFloat((iPrice !== -1 ? cols[iPrice] : '0').replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
      const delivery = (iDelivery !== -1 ? cols[iDelivery] : '').trim() || null;
      const track = (iTrack !== -1 ? cols[iTrack] : '').replace(/^=?"?|"?$/g, '').trim() || null;
      const payment = (iPayment !== -1 ? cols[iPayment] : '').trim() || 'avito_delivery';

      if (!sku && !name) continue; // пустая строка
      if (!sku) { errors.push({ row: li + 1, message: `Нет артикула — строка пропущена` }); continue; }
      if (!name) { errors.push({ row: li + 1, message: `Нет наименования — строка пропущена` }); continue; }
      if (qty <= 0) { errors.push({ row: li + 1, message: `Артикул ${sku}: некорректное количество` }); continue; }

      const key = track || `__notrack_${li}__`;
      if (!groups.has(key)) groups.set(key, { track, delivery, payment, items: [] });
      groups.get(key).items.push({ sku, name, qty, price });
    }

    const preview = [];
    for (const [, g] of groups) {
      preview.push({
        track: g.track,
        delivery: g.delivery,
        payment: g.payment,
        items: g.items,
        total: g.items.reduce((s, i) => s + i.qty * i.price, 0),
      });
    }

    if (dry_run) {
      return res.json({ dry_run: true, orders_to_create: preview.length, errors, preview });
    }

    // Создаём заказы
    let created = 0;
    for (const g of preview) {
      const items = g.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        quantity: i.qty,
        unit_price: i.price,
      }));
      const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const r = await db.run(
        `INSERT INTO orders (manager_id, marketplace, client_name, total_amount, currency,
          payment_method, delivery_method, shipment_qr, warehouse, status, notes)
         VALUES (?, ?, ?, ?, 'RUB', ?, ?, ?, ?, 'new', ?) RETURNING id`,
        req.user.id,
        null,
        null,
        total,
        null,
        g.delivery,
        g.track,
        warehouse || null,
        null,
      );
      const orderId = r.lastInsertRowid;
      for (const it of items) {
        await db.run(
          `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          orderId, it.sku, it.name, it.quantity, it.unit_price, it.quantity * it.unit_price,
        );
      }
      created++;
    }
    await logAction(req, {
      action: 'orders.imported',
      entity_type: 'order',
      entity_id: null,
      details: { created, errors: errors.length },
    });
    res.json({ dry_run: false, created, errors });
  }),
);

export default router;
