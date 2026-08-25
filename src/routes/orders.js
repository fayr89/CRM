import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { notify, notifyWarehouse, buildOrderNotificationBody } from '../services/notifications.js';
import { emitEvent } from '../services/webhooks.js';
import { notifyStockMovement } from '../services/stock-notify.js';
import { toCsv } from '../services/csv.js';
import ExcelJS from 'exceljs';
import { nextShippingDate, getSchedule } from '../services/shippingSchedule.js';
import { enqueueMsJob, enqueueMsJobFast } from '../services/ms-jobs.js';
import { applyLocalStockReserveDelta } from '../services/ms-orders.js';
import { notifyAdmins } from '../services/notifications.js';
import { logAction } from '../services/audit.js';

const router = Router();

// Защита от переполнения int4: orders.id — serial (макс 2 147 483 647).
// Если в :id прилетает число больше (например, Avito-номер заказа, ошибочно
// подставленный в ссылку/поле), драйвер Postgres падает 22003 «out of range»
// → 500 на любом /:id-роуте. Отдаём аккуратный 404. Литеральные пути
// (/export.csv, /import-template.csv, /clients/... и т.п.) сюда не попадают —
// param-callback срабатывает только на реальном совпадении с :id.
router.param('id', (req, res, next, value) => {
  if (!/^\d+$/.test(String(value)) || Number(value) > 2147483647) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  next();
});

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
  // Комиссия площадки (сумма ₽): при завершении заказа авто-создаётся расход в Кассе.
  commission: z.number().nonnegative().optional().nullable(),
  // Проект: для раздельного учёта (например, 2 аккаунта Авито = 2 проекта).
  project_id: z.number().int().positive().optional().nullable(),
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
  commission: z.number().nonnegative().optional().nullable(),
  project_id: z.number().int().positive().optional().nullable(),
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
//   manager           — свои + подчинённых + все waiting_stock (read-only для чужих)
//   sales             — свои + все waiting_stock (read-only для чужих)
async function orderScope(user) {
  if (user.role === 'admin') {
    return { sql: '', params: [] };
  }
  if (user.role === 'warehouse') {
    const whs = user.warehouses
      ? (Array.isArray(user.warehouses) ? user.warehouses : JSON.parse(user.warehouses))
      : null;
    if (whs && whs.length > 0) {
      return { sql: 'o.warehouse = ANY(?)', params: [whs] };
    }
    if (user.warehouse) {
      return { sql: 'o.warehouse = ?', params: [user.warehouse] };
    }
    return { sql: '', params: [] };
  }
  if (user.role === 'sales') {
    return { sql: "(manager_id = ? OR status = 'waiting_stock')", params: [user.id] };
  }
  const ids = await getAccessibleUserIds(user);
  return { sql: "(manager_id = ANY(?) OR status = 'waiting_stock')", params: [ids] };
}

// Может ли пользователь РЕДАКТИРОВАТЬ заказ (не только просматривать).
async function canEditOrder(user, order) {
  if (user.role === 'admin' || user.role === 'warehouse') return true;
  return canAccessUser(user, order.manager_id);
}

async function canAccessOrder(user, order) {
  // waiting_stock orders visible to all managers (read-only for non-owners).
  if (order.status === 'waiting_stock') {
    if (user.role === 'admin' || user.role === 'warehouse') return true;
    return true; // all managers can view; edit check happens separately
  }
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
    // Разделение каналов: direct=1 → только B2B (marketplace IS NULL),
    // marketplace_only=1 → только площадка-заказы (marketplace IS NOT NULL).
    // Без обоих фильтров — отдаются вообще все (используется для общих списков
    // вроде дашборда и админ-выгрузок).
    if (req.query.direct === '1') {
      where.push('o.marketplace IS NULL');
    } else if (req.query.marketplace_only === '1') {
      where.push('o.marketplace IS NOT NULL');
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
    // Фильтры дат: YYYY-MM-DD (формат <input type=date>). Включительно границы.
    if (req.query.date_from) {
      where.push("o.created_at >= ?::date");
      params.push(String(req.query.date_from));
    }
    if (req.query.date_to) {
      where.push("o.created_at < (?::date + INTERVAL '1 day')");
      params.push(String(req.query.date_to));
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
    // Подтягиваем items: один запрос для всех order_id. Отдаём весь массив
    // позиций для каждого заказа — фронт показывает построчно в списке.
    // JOIN с products нужен для cost_price (валовая прибыль админа) и чтобы
    // знать, у каких позиций нет прайса по этому каналу+складу.
    if (rows.length) {
      const orderIds = rows.map((r) => r.id);
      const itemsRows = await db.all(
        `SELECT oi.order_id, oi.id, oi.name, oi.sku, oi.quantity, oi.unit_price, oi.line_total,
                oi.image_url, oi.catalog_price, oi.product_id, p.cost_price,
                COALESCE(pp.price, oi.catalog_price) AS effective_price
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN orders ord ON ord.id = oi.order_id
         LEFT JOIN product_prices pp ON pp.product_id = oi.product_id
           AND pp.marketplace = 'Общий прайс'
           AND pp.warehouse = COALESCE(ord.warehouse, '')
         WHERE oi.order_id = ANY(?)
         ORDER BY oi.order_id, oi.id`,
        orderIds,
      );
      const byOrder = new Map();
      for (const it of itemsRows) {
        let agg = byOrder.get(it.order_id);
        if (!agg) {
          agg = {
            items: [], preview_image: null,
            items_no_price_count: 0, cost_total: 0,
          };
          byOrder.set(it.order_id, agg);
        }
        agg.items.push({
          id: it.id,
          sku: it.sku, name: it.name,
          quantity: it.quantity, unit_price: it.unit_price,
          line_total: it.line_total ?? Number(it.unit_price || 0) * Number(it.quantity || 0),
          image_url: it.image_url, catalog_price: it.catalog_price,
          effective_price: it.effective_price ?? null,
          product_id: it.product_id,
        });
        if (!agg.preview_image && it.image_url) agg.preview_image = it.image_url;
        if (it.catalog_price == null) agg.items_no_price_count += 1;
        agg.cost_total += Number(it.cost_price || 0) * Number(it.quantity || 0);
      }
      for (const r of rows) {
        const agg = byOrder.get(r.id) || { items: [], preview_image: null, items_no_price_count: 0, cost_total: 0 };
        r.items = agg.items;
        r.items_count = agg.items.length;
        r.preview_image = agg.preview_image;
        // Совместимость со старыми местами (карточка канбана использует first_item_*).
        const first = agg.items[0] || {};
        r.first_item_sku = first.sku ?? null;
        r.first_item_name = first.name ?? null;
        r.first_item_qty = first.quantity ?? null;
        r.first_item_price = first.unit_price ?? null;
        r.first_item_catalog_price = first.effective_price ?? null;
        r.items_preview = agg.items.slice(0, 5).map((i) => i.name).join(', ');
        r.items_no_price_count = agg.items_no_price_count;
        // Валовая прибыль — только админ/РОП.
        if (['admin', 'rop'].includes(req.user.role)) {
          r.cost_total = Math.round(agg.cost_total * 100) / 100;
          r.gross_profit = Math.round(((r.total_amount || 0) - agg.cost_total) * 100) / 100;
        }
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
    // Выгрузка конкретных выделенных заказов (например, из архива отгрузок) — ids
    // перекрывает status/marketplace/manager_id, но не видимость (scope ниже).
    const idsRaw = String(req.query.ids || '').trim();
    if (idsRaw) {
      const ids = idsRaw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (!ids.length) throw BadRequest('Некорректный параметр ids');
      where.push('o.id = ANY(?)');
      params.push(ids);
    } else if (req.query.status) {
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
    if (req.query.date_from) {
      where.push("o.created_at >= ?::date");
      params.push(String(req.query.date_from));
    }
    if (req.query.date_to) {
      where.push("o.created_at < (?::date + INTERVAL '1 day')");
      params.push(String(req.query.date_to));
    }
    if (req.query.shipped_from) {
      where.push("o.shipped_at >= ?::date");
      params.push(String(req.query.shipped_from));
    }
    if (req.query.shipped_to) {
      where.push("o.shipped_at < (?::date + INTERVAL '1 day')");
      params.push(String(req.query.shipped_to));
    }
    if (req.query.direct === '1') {
      where.push('o.marketplace IS NULL');
    } else if (req.query.marketplace_only === '1') {
      where.push('o.marketplace IS NOT NULL');
    }
    // Видимость: то же что в orderScope.
    if (req.user.role === 'sales') {
      where.push('o.manager_id = ?');
      params.push(req.user.id);
    } else if (req.user.role === 'manager') {
      const ids = await getAccessibleUserIds(req.user);
      where.push('o.manager_id = ANY(?)');
      params.push(ids);
    } else if (req.user.role === 'warehouse' && req.user.warehouse) {
      where.push('o.warehouse = ?');
      params.push(req.user.warehouse);
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

    // Способ отправки: предпочтительно delivery_method, если пусто — marketplace.
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
    const asTextForExcel = (v) => {
      const s = String(v ?? '').trim();
      return s ? `="${s.replace(/"/g, '""')}"` : '';
    };
    const ORDER_STATUS_LABELS = {
      waiting_stock: 'Ожидает товара',
      new: 'Новый',
      reserved: 'Зарезервирован',
      shipped: 'Отгружен',
      completed: 'Завершён',
      cancelled: 'Отменён',
    };

    // Формат xlsx с объединёнными ячейками (по запросу пользователя FB#43).
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Отгрузки');

    const COLS = [
      { header: 'Дата', key: 'date', width: 14 },
      { header: 'Артикул', key: 'sku', width: 18 },
      { header: 'Наименование', key: 'name', width: 32 },
      { header: 'Количество', key: 'qty', width: 12 },
      { header: 'Цена', key: 'price', width: 12 },
      { header: 'Способ отправки', key: 'ship', width: 20 },
      { header: 'Трек номер', key: 'track', width: 22 },
      { header: 'Менеджер', key: 'manager', width: 18 },
      { header: 'Комментарий', key: 'comment', width: 32 },
      { header: 'Статус', key: 'order_status', width: 16 },
    ];
    ws.columns = COLS;

    // Шапка: Arial 10 bold, перенос, тонкие границы, заливка
    const hdr = ws.getRow(1);
    hdr.font = { name: 'Arial', size: 10, bold: true };
    hdr.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    hdr.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Индексы для merge: col 1=Дата, 6=Способ, 7=Трек, 8=Менеджер, 9=Комментарий, 10=Статус
    const MERGE_COLS = [1, 6, 7, 8, 9, 10];

    let rowIdx = 2;
    for (const o of orders) {
      const list = itemsByOrder.get(o.id) || [{}];
      const startRow = rowIdx;

      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const isFirst = i === 0;
        const r = ws.addRow({
          date: isFirst && o.created_at ? new Date(o.created_at) : null,
          sku: it.sku != null ? String(it.sku) : null,
          name: it.name || null,
          qty: it.quantity != null ? Number(it.quantity) : null,
          price: it.unit_price != null ? Number(it.unit_price) : null,
          ship: isFirst ? (shipMethod(o) || null) : null,
          track: isFirst ? (o.shipment_qr || null) : null,
          manager: isFirst ? (o.manager_name || null) : null,
          comment: isFirst ? (o.notes || null) : null,
          order_status: isFirst ? (ORDER_STATUS_LABELS[o.status] || o.status || null) : null,
        });
        r.font = { name: 'Arial', size: 10 };
        r.alignment = { wrapText: true };
        // Артикул и Трек — текстовый формат (сохраняет ведущие нули)
        r.getCell('sku').numFmt = '@';
        r.getCell('track').numFmt = '@';
        // Дата — настоящее Excel-значение (не текст с запятой), можно менять формат в Excel
        // (например, на «только дата») через правый клик — Формат ячеек, без перепарсинга.
        r.getCell('date').numFmt = 'dd.mm.yyyy hh:mm';
        r.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin' }, left: { style: 'thin' },
            bottom: { style: 'thin' }, right: { style: 'thin' },
          };
        });
        rowIdx++;
      }

      // Объединяем ячейки уровня заказа если позиций > 1
      if (list.length > 1) {
        const endRow = startRow + list.length - 1;
        for (const col of MERGE_COLS) {
          ws.mergeCells(startRow, col, endRow, col);
          ws.getCell(startRow, col).alignment = { vertical: 'middle', wrapText: true };
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
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
    // Отбираем ТОЛЬКО заказы с непустым shipment_qr — только для них
    // будет страница в PDF. Остальные попадут в лог как «пропущены».
    const printableOrders = orders.filter((o) => String(o.shipment_qr || '').trim());
    const skippedIds = orders.filter((o) => !String(o.shipment_qr || '').trim()).map((o) => o.id);
    if (!printableOrders.length) {
      throw BadRequest(`Ни у одного из ${orders.length} заказов нет «Номера отправления». Печатать нечего. ID без QR: ${skippedIds.join(', ')}`);
    }
    const { generateLabelsPdf } = await import('../services/labels-pdf.js');
    const pdf = await generateLabelsPdf(printableOrders);
    // ФИКСИРУЕМ факт печати для тех, чьи страницы реально попали в PDF.
    // Раньше не было связи: склад мог «Отгрузить всех» без реальной печати
    // → заказы 1988/1984-86 помечались shipped, но наклейки не было.
    const printedIds = printableOrders.map((o) => o.id);
    try {
      await db.run(
        `UPDATE orders SET
           label_printed_at = NOW(),
           label_printed_by = ?,
           label_print_count = COALESCE(label_print_count, 0) + 1
         WHERE id = ANY(?)`,
        req.user.id, printedIds,
      );
    } catch (e) {
      // Не блокируем скачивание PDF если UPDATE упал — но логируем.
      console.error('[labels.pdf] update label_printed failed:', e.message);
    }
    const filename = `labels-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Метаданные в заголовках: сколько напечатано / пропущено. UI может показать
    // предупреждение «пропущены заказы без QR: ...».
    res.setHeader('X-Labels-Printed', String(printedIds.length));
    res.setHeader('X-Labels-Skipped', String(skippedIds.length));
    if (skippedIds.length) res.setHeader('X-Labels-Skipped-Ids', skippedIds.join(','));
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
    if (req.query.date_from) {
      where.push("o.created_at >= ?::date");
      params.push(String(req.query.date_from));
    }
    if (req.query.date_to) {
      where.push("o.created_at < (?::date + INTERVAL '1 day')");
      params.push(String(req.query.date_to));
    }
    if (req.query.direct === '1') {
      where.push('o.marketplace IS NULL');
    } else if (req.query.marketplace_only === '1') {
      where.push('o.marketplace IS NOT NULL');
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
    // Фильтр по складу: для роли «склад» — автоматически, для админа — по ?warehouse=.
    const whFilterParam = (() => {
      if (req.user.role === 'warehouse') {
        const whs = req.user.warehouses
          ? (Array.isArray(req.user.warehouses) ? req.user.warehouses : JSON.parse(req.user.warehouses))
          : null;
        if (whs && whs.length > 0) return { sql: ' AND o.warehouse = ANY(?)', params: [whs] };
        if (req.user.warehouse) return { sql: ' AND o.warehouse = ?', params: [req.user.warehouse] };
      } else if (req.user.role === 'admin' && req.query.warehouse) {
        return { sql: ' AND o.warehouse = ?', params: [String(req.query.warehouse)] };
      }
      return { sql: '', params: [] };
    })();
    const orders = await db.all(
      `SELECT o.id, o.reference_number, o.marketplace, o.client_name,
              o.total_amount, o.currency, o.manager_id, o.reserved_at,
              o.payment_method, o.shipment_qr, o.warehouse,
              o.label_printed_at, o.label_print_count,
              u.name AS manager_name,
              (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       WHERE o.status = 'reserved'${whFilterParam.sql}
       ORDER BY o.reserved_at ASC`,
      ...whFilterParam.params,
    );
    // Вычисляем дату отгрузки для каждого заказа по дате его резервации.
    for (const o of orders) {
      const d = o.reserved_at ? nextShippingDate(schedule?.days ?? '', schedule?.cutoff_time ?? '14:00', new Date(o.reserved_at)) : null;
      o.shipping_date = d ? d.toISOString() : null;
    }
    res.json({
      next_shipping_date: next ? next.toISOString() : null,
      schedule: schedule
        ? { days: schedule.days, cutoff_time: schedule.cutoff_time }
        : null,
      data: orders,
    });
  }),
);

// Архив отгрузок: заказы со статусом 'shipped', сгруппированные по дате,
// для просмотра склада и администраторов.
router.get(
  '/shipped-archive',
  asyncHandler(async (req, res) => {
    if (!['warehouse', 'admin'].includes(req.user.role)) {
      return res.json({ data: [] });
    }
    // Фильтр по диапазону дат отгрузки (shipped_at). Без дат — последние 200, как раньше.
    const where = [`o.status = 'shipped'`];
    const params = [];
    if (req.query.shipped_from) {
      where.push('o.shipped_at >= ?::date');
      params.push(String(req.query.shipped_from));
    }
    if (req.query.shipped_to) {
      where.push("o.shipped_at < (?::date + INTERVAL '1 day')");
      params.push(String(req.query.shipped_to));
    }
    const hasDateFilter = Boolean(req.query.shipped_from || req.query.shipped_to);
    const orders = await db.all(
      `SELECT o.id, o.marketplace, o.client_name,
              o.total_amount, o.currency, o.reserved_at, o.shipped_at,
              o.payment_method, o.shipment_qr,
              u.name AS manager_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.manager_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.shipped_at DESC NULLS LAST
       ${hasDateFilter ? '' : 'LIMIT 200'}`,
      ...params,
    );
    res.json({ data: orders });
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
              AND pp.marketplace = 'Общий прайс' AND pp.warehouse = ?
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
      warehouse,
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
      // Возврат на склад = поступление. Уведомляем подписчиков склада.
      notifyStockMovement(order.warehouse, 'receipt', {
        orderId: order.id, clientName: order.client_name,
        amount: order.total_amount, marketplace: order.marketplace,
      }).catch(() => {});
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

// GET /api/orders/import-template.csv — шаблон для импорта.
// Должен быть ОБЯЗАТЕЛЬНО до роута '/:id', иначе Express ловит «import-template.csv»
// как :id и запрос валится в 500 (Postgres: invalid integer для o.id).
router.get(
  '/import-template.csv',
  asyncHandler(async (_req, res) => {
    // Колонки: Артикул/Кол-во/Цена/Способ отправки/Трек. Без даты (ставится
    // автоматически по импорту) и без наименования (подтягивается из каталога
    // по артикулу). Справа после пустой колонки-разделителя — справочник
    // «Допустимые способы отправки» из настроек CRM.
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'delivery_methods'`)
      .catch(() => null);
    const methods = Array.isArray(setting?.value) && setting.value.length
      ? setting.value
      : ['Авито доставка', 'Почта', 'ЯМаркет', 'СДЭК', 'Dpd', '5post'];

    const esc = (v) => {
      const s = String(v ?? '');
      return /[;\"\n\r]/.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
    };
    const bom = '﻿';
    const headers = ['Артикул', 'Кол-во', 'Цена', 'Способ отправки', 'Трек номер', 'Склад', '', 'Допустимые способы отправки'];
    const example = ['12345678', '1', '999', methods[0] || 'Авито доставка', '60912345678', '', '', methods[0] || ''];

    const lines = [headers.map(esc).join(';'), example.map(esc).join(';')];
    for (let i = 1; i < methods.length; i++) {
      lines.push(['', '', '', '', '', '', '', methods[i]].map(esc).join(';'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-import-template.csv"');
    res.send(bom + lines.join('\r\n') + '\r\n');
  }),
);

// GET /api/orders/import-template-b2b.csv — шаблон для B2B-импорта.
// Те же колонки что в шаблоне Авито + дополнительно «Клиент» и «Телефон»,
// потому что у B2B-заказа обязательно есть клиент (компания/контакт).
// Тоже до '/:id' по той же причине что и обычный шаблон.
router.get(
  '/import-template-b2b.csv',
  asyncHandler(async (_req, res) => {
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'delivery_methods'`)
      .catch(() => null);
    const methods = Array.isArray(setting?.value) && setting.value.length
      ? setting.value
      : ['Авито доставка', 'Почта', 'ЯМаркет', 'СДЭК', 'Dpd', '5post'];

    const esc = (v) => {
      const s = String(v ?? '');
      return /[;\"\n\r]/.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
    };
    const bom = '﻿';
    // Артикул | Кол-во | Цена | Клиент | Телефон | Способ отправки | Трек номер | Склад
    // (+ справа справочник способов отправки).
    const headers = ['Артикул', 'Кол-во', 'Цена', 'Клиент', 'Телефон', 'Способ отправки', 'Трек номер', 'Склад', '', 'Допустимые способы отправки'];
    const example = ['12345678', '1', '999', 'ООО Ромашка', '+79001234567', methods[0] || 'СДЭК', '', '', '', methods[0] || ''];

    const lines = [headers.map(esc).join(';'), example.map(esc).join(';')];
    for (let i = 1; i < methods.length; i++) {
      lines.push(['', '', '', '', '', '', '', '', '', methods[i]].map(esc).join(';'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-import-template-b2b.csv"');
    res.send(bom + lines.join('\r\n') + '\r\n');
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
    // JOIN с products чтобы посчитать себестоимость и позиции без прайса (нужно
    // для отображения «N товаров без прайса» и валовой прибыли админу).
    const items = await db.all(
      `SELECT oi.*, p.cost_price
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.id`,
      order.id,
    );
    order.items_no_price_count = items.filter((i) => i.catalog_price == null).length;
    // Валовая прибыль (продажа − себес) — только админу и РОПу.
    if (['admin', 'rop'].includes(req.user.role)) {
      const costTotal = items.reduce((s, i) => s + Number(i.cost_price || 0) * Number(i.quantity || 0), 0);
      order.cost_total = Math.round(costTotal * 100) / 100;
      order.gross_profit = Math.round(((order.total_amount || 0) - costTotal) * 100) / 100;
    }
    // Заметка для менеджера — склад не видит.
    if (req.user.role === 'warehouse') order.manager_note = null;
    // can_edit: waiting_stock заказы видны всем, но чужие — только для просмотра.
    order.can_edit = await canEditOrder(req.user, order);
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
          total_amount, currency, manager_id, notes, manager_note, status,
          commission, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
        data.commission ?? null,
        data.project_id ?? null,
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
    // Редактировать может только владелец/РОП/склад/админ.
    if (!(await canEditOrder(req.user, order))) throw Forbidden('Вы можете только просматривать этот заказ');
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
        'commission',
        'project_id',
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
    if (!(await canEditOrder(req.user, order))) {
      throw Forbidden('Нет прав на этот заказ');
    }
    if (order.status !== 'new') throw BadRequest('Зарезервировать можно только новый заказ');
    // Номер отправления обязателен для маркетплейс-заказов. B2B-заказы (marketplace=NULL)
    // отгружаются напрямую клиенту, у них нет внешнего трека маркетплейса.
    if (order.marketplace && (!order.shipment_qr || !String(order.shipment_qr).trim())) {
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
      const existing = await tx.get('SELECT id FROM payments WHERE order_id = ? AND kind = \'income\'', order.id);
      if (!existing && (order.total_amount || 0) > 0) {
        await tx.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'income', 'pending', ?, ?, NOW(), NOW())`,
          order.manager_id,
          order.id,
          order.total_amount,
          order.currency || 'RUB',
          `Заказ #${order.id}${order.marketplace ? ' · ' + order.marketplace : ''}`,
          order.project_id ?? null,
        );
      }
    });
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // Синхронно обновляем локальный резерв — не ждём МС-очереди, чтобы другой менеджер
    // сразу видел актуальное доступное количество.
    try { await applyLocalStockReserveDelta(order.id, 0, +1); } catch (e) {
      console.warn('[reserve] applyLocalStockReserveDelta failed:', e.message);
    }
    // МС: ставим/обновляем customerorder — INSERT в ms_jobs БЕЗ синхронного исполнения
    // (экономит до 2с). tickMsQueue на следующем /api-запросе (или cron) подхватит.
    await enqueueMsJobFast(order.id, 'customer_order.upsert', { reserve_mode: 'full' });
    // Отвечаем клиенту СРАЗУ — уведомления и audit уходят в фон.
    res.json(updated);
    // Fire-and-forget: notify менеджеру и админам + audit + emit. На Vercel
    // setImmediate ненадёжен (лямбда может замёрзнуть), но потеря push'а или
    // audit-строки — приемлемый компромисс за скорость (данные и МС-задача
    // уже сохранены синхронно).
    setImmediate(async () => {
      try {
        const reservedBody = await buildOrderNotificationBody(order.id);
        await Promise.all([
          notify(order.manager_id, 'order.reserved', 'Заказ зарезервирован',
            reservedBody + '\n\n✅ Склад готов отгружать', `#/orders?id=${order.id}`),
          notifyAdmins('order.reserved', `✅ Заказ #${order.id} зарезервирован`,
            reservedBody, `#/orders?id=${order.id}`),
          logAction(req, { action: 'order.reserved', entity_type: 'order', entity_id: order.id }),
        ]);
        emitEvent('order.reserved', updated);
        // Уведомляем подписчиков движений по этому складу (резерв = списание).
        notifyStockMovement(updated.warehouse, 'reserve', {
          orderId: order.id, clientName: updated.client_name,
          amount: updated.total_amount, marketplace: updated.marketplace,
        }).catch(() => {});
      } catch (e) { console.error('[reserve async]', e.message); }
    });
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
    // МС «Отгрузка» — INSERT в очередь, tickMsQueue выполнит (экономит до 2с).
    await enqueueMsJobFast(order.id, 'demand.create');
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    // Отвечаем клиенту сразу — уведомления и audit в фон.
    res.json(updated);
    setImmediate(async () => {
      try {
        const shippedBody = await buildOrderNotificationBody(order.id);
        await Promise.all([
          notify(order.manager_id, 'order.shipped', 'Заказ отгружен',
            shippedBody + '\n\n📦 Можно завершать', `#/orders?id=${order.id}`),
          notifyAdmins('order.shipped', `📦 Заказ #${order.id} отгружен`,
            shippedBody, `#/orders?id=${order.id}`),
          logAction(req, { action: 'order.shipped', entity_type: 'order', entity_id: order.id }),
        ]);
        emitEvent('order.shipped', updated);
        notifyStockMovement(updated.warehouse, 'ship', {
          orderId: order.id, clientName: updated.client_name,
          amount: updated.total_amount, marketplace: updated.marketplace,
        }).catch(() => {});
      } catch (e) { console.error('[ship async]', e.message); }
    });
  }),
);

// Массовое подтверждение отгрузки (склад выбирает заказы и отгружает разом).
// Раньше на каждый заказ последовательно делалось 5+ SQL-запросов (build body,
// notify менеджера, notifyAdmins с внутренним циклом, logAction, enqueueMsJob).
// На 100 заказов + 3 админа = ~1300 круговых к пулеру → таймаут 60с. Теперь:
// (1) агрегируем body-данные ОДНИМ SELECT-ом, (2) SELECT admins один раз,
// (3) INSERT в notifications + audit_log ОДНИМ батч-инсертом, (4) МС-задачи и
// MAX-пуши уходят fire-and-forget параллельно с concurrency-лимитом.
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
    // Агрегируем body-данные одним SELECT-ом (вместо N × 3 запросов).
    const bodyRows = await db.all(
      `SELECT o.id, o.client_name, o.total_amount, o.currency, o.marketplace,
              u.name AS manager_name,
              (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS items_total,
              (SELECT string_agg('• ' || name || ' × ' || quantity, E'\n' ORDER BY id)
               FROM (SELECT name, quantity, id FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 5) t)
              AS items_preview
       FROM orders o LEFT JOIN users u ON u.id = o.manager_id
       WHERE o.id = ANY(?)`,
      shippedIds,
    );
    const bodyById = new Map(bodyRows.map((r) => [r.id, r]));
    const buildBody = (o) => {
      const r = bodyById.get(o.id);
      if (!r) return '';
      const parts = [];
      parts.push(`💰 ${(r.total_amount || 0).toLocaleString('ru-RU')} ${r.currency || 'RUB'}`);
      if (r.manager_name) parts.push(`👤 ${r.manager_name}`);
      if (r.client_name) parts.push(`🧑 ${r.client_name}`);
      if (r.marketplace) parts.push(`🛒 ${r.marketplace}`);
      let body = parts.join(' · ');
      if (r.items_preview) {
        body += '\n\nСостав:\n' + r.items_preview;
        if (r.items_total > 5) body += `\n…и ещё ${r.items_total - 5}`;
      }
      return body;
    };
    // Список админов — один SELECT (вместо notifyAdmins × N с внутренним SELECT).
    const admins = await db.all(
      `SELECT id, max_chat_id FROM users WHERE role = 'admin' AND active = TRUE`,
    );
    // Собираем все уведомления в массив и одним батчем пишем в notifications.
    const notifs = []; // { user_id, type, title, body, link, max_chat_id }
    // Кэш max_chat_id менеджеров одним запросом.
    const managerIds = [...new Set(orders.map((o) => o.manager_id).filter(Boolean))];
    const managers = managerIds.length
      ? await db.all(`SELECT id, max_chat_id FROM users WHERE id = ANY(?)`, managerIds)
      : [];
    const mgrChatById = new Map(managers.map((m) => [m.id, m.max_chat_id]));
    for (const order of orders) {
      const body = buildBody(order);
      const link = `#/orders?id=${order.id}`;
      if (order.manager_id) {
        notifs.push({
          user_id: order.manager_id, type: 'order.shipped',
          title: 'Заказ отгружен', body: body + '\n\n📦 Можно завершать', link,
          max_chat_id: mgrChatById.get(order.manager_id) || null,
        });
      }
      for (const a of admins) {
        notifs.push({
          user_id: a.id, type: 'order.shipped',
          title: `📦 Заказ #${order.id} отгружен`, body, link,
          max_chat_id: a.max_chat_id || null,
        });
      }
      emitEvent('order.shipped', { ...order, status: 'shipped' });
      // Подписчики движений по складу — уведомляем каждого.
      notifyStockMovement(order.warehouse, 'ship', {
        orderId: order.id, clientName: order.client_name,
        amount: order.total_amount, marketplace: order.marketplace,
      }).catch(() => {});
    }
    // Батч-INSERT в notifications (чанками по 500 значений: 5 колонок × 500 = 2500 плейсхолдеров — ок).
    const NOTIF_CHUNK = 500;
    for (let i = 0; i < notifs.length; i += NOTIF_CHUNK) {
      const chunk = notifs.slice(i, i + NOTIF_CHUNK);
      const rowsSql = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const params = [];
      for (const n of chunk) params.push(n.user_id, n.type, n.title, n.body, n.link);
      await db.run(
        `INSERT INTO notifications (user_id, type, title, body, link) VALUES ${rowsSql}`,
        ...params,
      ).catch((e) => console.error('[ship-bulk] notifications batch:', e.message));
    }
    // Батч-INSERT в audit_log.
    const auditRowsSql = orders.map(() => '(?, ?, ?, ?, ?, ?, ?::jsonb, ?)').join(', ');
    const auditParams = [];
    const ip = (req?.headers?.['x-forwarded-for'] || req?.ip || '').toString().split(',')[0].trim() || null;
    for (const o of orders) {
      auditParams.push(
        req.user?.id || null, req.user?.name || null, req.user?.role || null,
        'order.shipped', 'order', o.id,
        JSON.stringify({ bulk: true }), ip,
      );
    }
    await db.run(
      `INSERT INTO audit_log (user_id, user_name, user_role, action, entity_type, entity_id, details, ip)
       VALUES ${auditRowsSql}`,
      ...auditParams,
    ).catch((e) => console.error('[ship-bulk] audit_log batch:', e.message));
    // МС-задачи: одним батч-INSERT в ms_jobs (без синхронного runPendingMsJobs —
    // при 100+ заказах 100×2с = таймаут). Cron/tick подхватит очередь. Дедуп по
    // (order_id, action) через ON CONFLICT — coalesce с существующей pending.
    if (shippedIds.length) {
      const msRowsSql = shippedIds.map(() => "(?, 'demand.create', '{}'::jsonb)").join(', ');
      await db.run(
        `INSERT INTO ms_jobs (order_id, action, payload) VALUES ${msRowsSql}`,
        ...shippedIds,
      ).catch(async (e) => {
        console.error('[ship-bulk] ms_jobs batch insert:', e.message);
        // Фолбэк — построчно (например при уник-нарушении дублей).
        for (const oid of shippedIds) {
          await enqueueMsJob(oid, 'demand.create').catch((e2) =>
            console.error(`[ms] enqueue demand.create #${oid}:`, e2.message));
        }
      });
    }
    // Отвечаем СРАЗУ — MAX-пуши уходят в фон (уведомления в БД уже сохранены).
    res.json({ ok: true, shipped: shippedIds.length, skipped: ids.length - shippedIds.length });

    // MAX-пуши в фоне: не критичны — юзер увидит уведомления через колокольчик
    // и notifications API. setImmediate на Vercel serverless ненадёжен (лямбда
    // может замёрзнуть), но пропущенные пуши — приемлемый компромисс за скорость.
    setImmediate(async () => {
      const { sendMaxMessage } = await import('../services/max-bot.js').catch(() => ({}));
      if (!sendMaxMessage) return;
      const withChat = notifs.filter((n) => n.max_chat_id);
      const base = process.env.PUBLIC_URL || 'https://crm.iitit.ru';
      const CONCURRENCY = 5;
      for (let i = 0; i < withChat.length; i += CONCURRENCY) {
        const slice = withChat.slice(i, i + CONCURRENCY);
        await Promise.all(slice.map((n) => {
          const fullLink = n.link && n.link.startsWith('#') ? `${base}/${n.link}` : n.link;
          return sendMaxMessage(n.max_chat_id, `${n.title}${n.body ? '\n\n' + n.body : ''}`, fullLink)
            .catch((e) => console.error('[ship-bulk] MAX push:', e.message));
        }));
      }
    });
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
    // Авто-расход в Кассу на сумму комиссии при завершении (идемпотентно — не дублируем).
    if (order.commission && Number(order.commission) > 0) {
      try {
        const existingCommission = await db.get(
          `SELECT id FROM payments WHERE order_id = ? AND kind = 'expense' AND notes LIKE 'Комиссия заказа%'`,
          order.id,
        );
        if (!existingCommission) {
          await db.run(
            `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, project_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'expense', 'confirmed', ?, ?, NOW(), NOW())`,
            order.manager_id,
            order.id,
            Number(order.commission),
            order.currency || 'RUB',
            `Комиссия заказа #${order.id}`,
            order.project_id ?? null,
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[complete] не удалось создать расход-комиссию:', e.message);
      }
    }
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    res.json(updated);
    // Fire-and-forget audit + emit — не критично для UX.
    setImmediate(async () => {
      try {
        emitEvent('order.completed', updated);
        await logAction(req, { action: 'order.completed', entity_type: 'order', entity_id: order.id });
      } catch (e) { console.error('[complete async]', e.message); }
    });
  }),
);

// Подтверждение факта отгрузки менеджером — только флаг, статус не меняется.
// Доступно: manager (владелец заказа) или admin. Статусы: reserved, shipped.
router.post(
  '/:id/confirm-shipping',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    const isAdminOrOwner = req.user.role === 'admin' || req.user.id === order.manager_id;
    if (!isAdminOrOwner) throw Forbidden('Только владелец заказа или администратор могут подтвердить отгрузку');
    if (!['reserved', 'shipped'].includes(order.status)) {
      throw BadRequest('Подтвердить отгрузку можно только для зарезервированного или отгруженного заказа');
    }
    if (order.manager_shipping_confirmed) {
      return res.json({ ok: true, already_confirmed: true });
    }
    await db.run(
      `UPDATE orders SET manager_shipping_confirmed = TRUE,
       manager_shipping_confirmed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      order.id,
    );
    await logAction(req, { action: 'order.manager_shipping_confirmed', entity_type: 'order', entity_id: order.id });
    res.json({ ok: true, confirmed_at: new Date().toISOString() });
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
    if (order.status === 'cancelled') {
      throw BadRequest('Заказ уже отменён');
    }
    if (order.status === 'completed' && req.user.role !== 'admin') {
      throw BadRequest('Завершённый заказ может отменить только администратор');
    }
    if (!isAdminOrWarehouse && !['new', 'reserved', 'waiting_stock', 'shipped'].includes(order.status)) {
      throw BadRequest('Этот заказ уже нельзя отменить');
    }
    // Если товар был зарезервирован/отгружён/завершён — заказ попадает в «Возвраты».
    // Для waiting_stock и new возврата нет — товар не списывался.
    const needsReturn = ['reserved', 'shipped', 'completed'].includes(order.status);
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
    // МС: если был резерв — INSERT в очередь без sync run.
    if (['reserved', 'shipped'].includes(order.status)) {
      await enqueueMsJobFast(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    }
    res.json(updated);
    setImmediate(async () => {
      try {
        emitEvent('order.cancelled', updated);
        await logAction(req, { action: 'order.cancelled', entity_type: 'order', entity_id: order.id, details: { reason, from_status: order.status } });
      } catch (e) { console.error('[cancel async]', e.message); }
    });
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
    // Синхронно снимаем локальный резерв — сразу видно доступное количество.
    try { await applyLocalStockReserveDelta(order.id, 0, -1); } catch (e) {
      console.warn('[unreserve] applyLocalStockReserveDelta failed:', e.message);
    }
    // МС: снимаем резерв — INSERT в очередь без sync run.
    await enqueueMsJobFast(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    res.json(updated);
    setImmediate(async () => {
      try {
        emitEvent('order.updated', updated);
        await logAction(req, { action: 'order.unreserved', entity_type: 'order', entity_id: order.id });
      } catch (e) { console.error('[unreserve async]', e.message); }
    });
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
    // Fast-версия: INSERT в очередь, tickMsQueue выполнит (экономит до 2с).
    if (prevStatus === 'reserved') {
      await enqueueMsJobFast(order.id, 'customer_order.upsert', { reserve_mode: 'none' });
    }
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    res.json(updated);
    setImmediate(async () => {
      try {
        emitEvent('order.updated', updated);
        await logAction(req, { action: 'order.mark_waiting', entity_type: 'order', entity_id: order.id, details: { from_status: prevStatus } });
      } catch (e) { console.error('[mark-waiting async]', e.message); }
    });
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
    // МС: удаляем документ «Отгрузка» — в очередь без sync run.
    await enqueueMsJobFast(order.id, 'demand.delete');
    const updated = await db.get('SELECT * FROM orders WHERE id = ?', order.id);
    res.json(updated);
    setImmediate(async () => {
      try {
        emitEvent('order.updated', updated);
        await logAction(req, { action: 'order.unshipped', entity_type: 'order', entity_id: order.id });
      } catch (e) { console.error('[unship async]', e.message); }
    });
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


const importBodySchema = z.object({
  csv: z.string().min(1),
  dry_run: z.boolean().optional().default(true),
  warehouse: z.string().optional().nullable(),
  // b2b=true: marketplace создаваемых заказов = NULL, payment по умолчанию rs_no_vat,
  // classification = B2B. Парсер также прочитает колонки Клиент/Телефон если есть.
  b2b: z.boolean().optional().default(false),
});

// POST /api/orders/import — разбор CSV и создание заказов
router.post(
  '/import',
  requireRole('admin', 'manager', 'sales'),
  asyncHandler(async (req, res) => {
    const { csv, dry_run, warehouse, b2b } = importBodySchema.parse(req.body || {});
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
    const iDelivery = colIdx(['способ отправки', 'способ доставки', 'отправк', 'доставка', 'delivery', 'служба']);
    const iTrack = colIdx(['трек', 'track', 'отправление', 'shipment']);
    const iPayment = colIdx(['оплата', 'payment', 'pay']);
    // B2B-шаблон: дополнительные колонки клиент/телефон. Один заказ = один трек
    // (как и в Авито-шаблоне); если трека нет — группируем по (клиент, телефон),
    // чтобы все строки одного клиента сложились в один заказ.
    const iClient = colIdx(['клиент', 'компания', 'client', 'company']);
    const iPhone = colIdx(['телефон', 'phone', 'тел.']);
    const iWarehouseCol = colIdx(['склад', 'warehouse', 'склад отгрузки']);

    if (iSku === -1 || iQty === -1 || iPrice === -1) {
      throw BadRequest('Не найдены обязательные колонки: Артикул, Кол-во, Цена. Скачайте шаблон.');
    }

    // Сначала собираем сырые строки (с возможно пустым name), затем одним
    // запросом подтягиваем имена/id из products по артикулам.
    const rawRows = [];
    const skuSet = new Set();
    const errors = [];
    for (let li = 1; li < lines.length; li++) {
      const cols = parseCsvRow(lines[li], sep);
      const sku = (iSku !== -1 ? cols[iSku] : '').replace(/^=?"?|"?$/g, '').trim();
      const name = (iName !== -1 ? (cols[iName] || '').trim() : '');
      const qty = parseInt((iQty !== -1 ? cols[iQty] : '0').replace(/[^0-9]/g, '')) || 0;
      const price = parseFloat((iPrice !== -1 ? cols[iPrice] : '0').replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
      const delivery = (iDelivery !== -1 ? cols[iDelivery] : '').trim() || null;
      const track = (iTrack !== -1 ? cols[iTrack] : '').replace(/^=?"?|"?$/g, '').trim() || null;
      // Для B2B-импорта дефолт оплаты «РС без НДС», для маркетплейс-импорта — «Авито доставка».
      const payment = (iPayment !== -1 ? cols[iPayment] : '').trim() || (b2b ? 'rs_no_vat' : 'avito_delivery');
      const client = (iClient !== -1 ? cols[iClient] : '').trim() || null;
      const phone = (iPhone !== -1 ? cols[iPhone] : '').trim() || null;
      const rowWarehouse = (iWarehouseCol !== -1 ? cols[iWarehouseCol] : '').trim() || null;

      if (!sku && !name) continue; // пустая строка
      if (!sku) { errors.push({ row: li + 1, message: `Нет артикула — строка пропущена` }); continue; }
      if (qty <= 0) { errors.push({ row: li + 1, message: `Артикул ${sku}: некорректное количество` }); continue; }

      skuSet.add(sku);
      rawRows.push({ li, sku, name, qty, price, delivery, track, payment, client, phone, rowWarehouse });
    }

    // Подтягиваем product_id и имя из каталога. Если в файле имя не указано —
    // ставим имя из products; если товара нет в каталоге, fallback на "Товар <sku>".
    const productMap = new Map();
    if (skuSet.size) {
      const prodRows = await db.all(
        'SELECT id, sku, name FROM products WHERE sku = ANY(?)',
        Array.from(skuSet),
      );
      for (const p of prodRows) {
        productMap.set(String(p.sku).trim(), { id: p.id, name: p.name });
      }
    }

    const groups = new Map();
    for (const r of rawRows) {
      const p = productMap.get(r.sku);
      const name = r.name || p?.name || `Товар ${r.sku}`;
      const product_id = p?.id ?? null;
      // Ключ группировки: трек если есть; в B2B-режиме можем сгруппировать по
      // клиенту+телефону (один клиент = один заказ из импорта); fallback —
      // каждая строка отдельным заказом.
      const key = r.track
        || (b2b && (r.client || r.phone) ? `__b2b_${(r.client || '').toLowerCase()}_${r.phone || ''}` : `__notrack_${r.li}__`);
      if (!groups.has(key)) {
        groups.set(key, {
          track: r.track,
          delivery: r.delivery,
          payment: r.payment,
          client: r.client,
          phone: r.phone,
          rowWarehouse: r.rowWarehouse,
          items: [],
        });
      }
      groups.get(key).items.push({ sku: r.sku, name, qty: r.qty, price: r.price, product_id });
    }

    const preview = [];
    for (const [, g] of groups) {
      preview.push({
        track: g.track,
        delivery: g.delivery,
        payment: g.payment,
        client: g.client,
        phone: g.phone,
        rowWarehouse: g.rowWarehouse,
        items: g.items,
        total: g.items.reduce((s, i) => s + i.qty * i.price, 0),
      });
    }

    if (dry_run) {
      return res.json({ dry_run: true, orders_to_create: preview.length, errors, preview });
    }

    // Создаём заказы. В B2B-режиме: classification='B2B', marketplace=NULL,
    // дефолт payment_method='rs_no_vat' (если в файле не указан другой),
    // client_name/phone из колонок Клиент/Телефон.
    let created = 0;
    for (const g of preview) {
      const items = g.items.map((i) => ({
        sku: i.sku,
        name: i.name,
        quantity: i.qty,
        unit_price: i.price,
        product_id: i.product_id ?? null,
      }));
      const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const r = await db.run(
        `INSERT INTO orders (manager_id, marketplace, client_name, client_phone, client_classification,
          total_amount, currency, payment_method, delivery_method, shipment_qr, warehouse, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'RUB', ?, ?, ?, ?, 'new', ?) RETURNING id`,
        req.user.id,
        null,
        g.client || null,
        g.phone || null,
        b2b ? 'B2B' : null,
        total,
        g.payment || null,
        g.delivery,
        g.track,
        g.rowWarehouse || warehouse || null,
        null,
      );
      const orderId = r.lastInsertRowid;
      for (const it of items) {
        await db.run(
          `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total, product_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          orderId, it.sku, it.name, it.quantity, it.unit_price, it.quantity * it.unit_price, it.product_id,
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
