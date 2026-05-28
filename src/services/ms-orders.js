// Высокоуровневая логика синхронизации заказов CRM ↔ customerorder в МС.
// Резолвит контрагента (по менеджеру заказа), собирает positions с product/store UUID,
// делает upsert: POST если нет ms_customer_order_id, PUT если есть.
import { db } from '../db.js';
import {
  msCreate, msUpdate, msHref, msFindCounterpartyByName,
} from './moysklad.js';
import { getMoyskladToken, getMsConfig, setMsSetting } from './ms-jobs.js';

// --- Counterparty resolver: менеджер CRM → контрагент МС, с кэшем в app_settings ---
async function getManagerMap() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.manager_counterparty_map'`).catch(() => null);
  return row?.value || {};
}

async function saveManagerMap(map) {
  await setMsSetting('moysklad.manager_counterparty_map', map);
}

async function resolveManagerCounterparty(token, managerId) {
  if (!managerId) return null;
  const map = await getManagerMap();
  if (map[managerId]) return map[managerId];

  const user = await db.get('SELECT name, email FROM users WHERE id = ?', managerId);
  const name = (user?.name || user?.email || `Manager ${managerId}`).trim();

  // Сначала ищем по имени — может уже есть.
  const found = await msFindCounterpartyByName(token, name);
  let uuid;
  if (found.length) {
    uuid = found[0].id;
  } else {
    const created = await msCreate(token, 'counterparty', {
      name,
      companyType: 'individual',
      description: `Создано из CRM: менеджер #${managerId}`,
    });
    uuid = created.id;
  }
  map[managerId] = uuid;
  await saveManagerMap(map);
  return uuid;
}

// Подтянуть позиции заказа с MS-UUID товаров.
async function fetchOrderPositions(orderId) {
  return await db.all(
    `SELECT oi.id, oi.name, oi.quantity, oi.unit_price, oi.line_total,
            p.external_id AS ms_product_id, p.external_source AS ms_source
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?
     ORDER BY oi.id`,
    orderId,
  );
}

// Сформировать body для customerorder POST/PUT.
// reserveMode: 'full' (reserve = quantity), 'none' (reserve = 0).
async function buildCustomerOrderBody(token, order, { reserveMode = 'full' } = {}) {
  const cfg = await getMsConfig();
  if (!cfg.organization_id) throw new Error('МС не инициализирован: нет organization_id');

  const storeId = cfg.store_map?.[order.warehouse];
  // Без склада в МС резерв не привязан к месту — пропускаем поле store, МС возьмёт дефолтный.
  // Лучше всё-таки требовать: если заказ имеет warehouse, а в МС такого склада нет — ошибка.
  if (order.warehouse && !storeId) {
    throw new Error(`Склад «${order.warehouse}» не найден в МС. Запустите «Переинициализировать».`);
  }

  const counterpartyId = await resolveManagerCounterparty(token, order.manager_id);
  if (!counterpartyId) throw new Error('Не удалось определить контрагента (менеджер заказа не задан)');

  const items = await fetchOrderPositions(order.id);
  const positions = [];
  const skipped = [];
  for (const it of items) {
    if (!it.ms_product_id) {
      // Товар не из МС — пропускаем, но фиксируем в логе.
      skipped.push(it.name);
      continue;
    }
    positions.push({
      assortment: msHref('product', it.ms_product_id),
      quantity: it.quantity,
      price: Math.round((it.unit_price || 0) * 100), // МС хранит цены в копейках
      reserve: reserveMode === 'full' ? it.quantity : 0,
    });
  }

  const body = {
    organization: msHref('organization', cfg.organization_id),
    agent: msHref('counterparty', counterpartyId),
    name: order.reference_number ? `CRM-${order.id}/${order.reference_number}` : `CRM-${order.id}`,
    description: `CRM #${order.id}${order.client_name ? ' · ' + order.client_name : ''}`,
    positions,
  };
  if (storeId) body.store = msHref('store', storeId);

  return { body, skipped };
}

// Обработчик задачи: создать/обновить customerorder с заданным режимом резерва.
// payload: { reserve_mode: 'full' | 'none' }
export async function customerOrderUpsertHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');

  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);

  const reserveMode = job.payload?.reserve_mode || 'full';
  const { body, skipped } = await buildCustomerOrderBody(token, order, { reserveMode });

  if (skipped.length) {
    console.warn(`[ms-orders] order #${order.id}: пропущены позиции без МС-привязки: ${skipped.join('; ')}`);
  }
  if (!body.positions.length) {
    throw new Error('Все позиции заказа без привязки к МС — нечего отправлять');
  }

  let result;
  if (order.ms_customer_order_id) {
    result = await msUpdate(token, 'customerorder', order.ms_customer_order_id, body);
  } else {
    result = await msCreate(token, 'customerorder', body);
    await db.run('UPDATE orders SET ms_customer_order_id = ? WHERE id = ?', result.id, order.id);
  }
  return { ms_document_id: result.id };
}
