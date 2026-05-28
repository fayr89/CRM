// Высокоуровневая логика синхронизации заказов CRM ↔ customerorder в МС.
// Резолвит контрагента (по менеджеру заказа), собирает positions с product/store UUID,
// делает upsert: POST если нет ms_customer_order_id, PUT если есть.
import { db } from '../db.js';
import {
  msCreate, msUpdate, msDelete, msHref, msFindCounterpartyByName,
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

// --- Demand (отгрузка): создание / удаление ---

async function buildDemandBody(token, order) {
  const cfg = await getMsConfig();
  if (!cfg.organization_id) throw new Error('МС не инициализирован: нет organization_id');
  if (!order.ms_customer_order_id) {
    throw new Error('У заказа нет ms_customer_order_id — задача customer_order.upsert ещё не выполнилась. Будет автоматический retry.');
  }

  const storeId = cfg.store_map?.[order.warehouse];
  if (order.warehouse && !storeId) {
    throw new Error(`Склад «${order.warehouse}» не найден в МС. Переинициализируйте конфиг.`);
  }

  const counterpartyId = await resolveManagerCounterparty(token, order.manager_id);
  if (!counterpartyId) throw new Error('Не удалось определить контрагента');

  const items = await fetchOrderPositions(order.id);
  const positions = items
    .filter((it) => it.ms_product_id)
    .map((it) => ({
      assortment: msHref('product', it.ms_product_id),
      quantity: it.quantity,
      price: Math.round((it.unit_price || 0) * 100),
    }));
  if (!positions.length) throw new Error('У заказа нет позиций, привязанных к МС');

  const body = {
    organization: msHref('organization', cfg.organization_id),
    agent: msHref('counterparty', counterpartyId),
    customerOrder: msHref('customerorder', order.ms_customer_order_id),
    name: order.reference_number ? `CRM-${order.id}/отгр/${order.reference_number}` : `CRM-${order.id}/отгрузка`,
    description: `Отгрузка из CRM #${order.id}${order.client_name ? ' · ' + order.client_name : ''}`,
    positions,
  };
  if (storeId) body.store = msHref('store', storeId);
  return body;
}

export async function demandCreateHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);
  // Идемпотентность: документ уже создан — ничего не делаем.
  if (order.ms_demand_id) return { ms_document_id: order.ms_demand_id };

  const body = await buildDemandBody(token, order);
  const result = await msCreate(token, 'demand', body);
  await db.run('UPDATE orders SET ms_demand_id = ? WHERE id = ?', result.id, order.id);
  return { ms_document_id: result.id };
}

export async function demandDeleteHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);
  // Идемпотентность: документа уже нет — ничего не делаем.
  if (!order.ms_demand_id) return {};

  await msDelete(token, 'demand', order.ms_demand_id);
  await db.run('UPDATE orders SET ms_demand_id = NULL WHERE id = ?', order.id);
  return {};
}

// --- Customer return (возврат от покупателя): оприходование на склад ---

async function buildCustomerReturnBody(token, order) {
  const cfg = await getMsConfig();
  if (!cfg.organization_id) throw new Error('МС не инициализирован: нет organization_id');

  const storeId = cfg.store_map?.[order.warehouse];
  if (order.warehouse && !storeId) {
    throw new Error(`Склад «${order.warehouse}» не найден в МС.`);
  }
  const counterpartyId = await resolveManagerCounterparty(token, order.manager_id);
  if (!counterpartyId) throw new Error('Не удалось определить контрагента');

  const items = await fetchOrderPositions(order.id);
  const positions = items
    .filter((it) => it.ms_product_id)
    .map((it) => ({
      assortment: msHref('product', it.ms_product_id),
      quantity: it.quantity,
      price: Math.round((it.unit_price || 0) * 100),
    }));
  if (!positions.length) throw new Error('У заказа нет позиций с привязкой к МС');

  const body = {
    organization: msHref('organization', cfg.organization_id),
    agent: msHref('counterparty', counterpartyId),
    name: order.reference_number
      ? `CRM-${order.id}/возврат/${order.reference_number}`
      : `CRM-${order.id}/возврат`,
    description: `Возврат покупателя по CRM #${order.id}${order.cancel_reason ? ' · ' + order.cancel_reason : ''}`,
    positions,
  };
  if (storeId) body.store = msHref('store', storeId);
  // МС привязывает возврат к отгрузке, если есть — корректнее учёт.
  if (order.ms_demand_id) body.demand = msHref('demand', order.ms_demand_id);
  return body;
}

export async function customerReturnCreateHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);
  if (order.ms_return_id) return { ms_document_id: order.ms_return_id };

  const body = await buildCustomerReturnBody(token, order);
  // В МС endpoint называется salesreturn (Возврат покупателя). Наш внутренний action
  // 'customerreturn.create' — историческое имя, не меняем чтобы не сбросить очередь.
  const result = await msCreate(token, 'salesreturn', body);
  await db.run('UPDATE orders SET ms_return_id = ? WHERE id = ?', result.id, order.id);
  return { ms_document_id: result.id };
}

// --- Loss (списание): расход со склада без выручки ---

async function buildLossBody(token, order) {
  const cfg = await getMsConfig();
  if (!cfg.organization_id) throw new Error('МС не инициализирован: нет organization_id');

  const storeId = cfg.store_map?.[order.warehouse];
  if (order.warehouse && !storeId) {
    throw new Error(`Склад «${order.warehouse}» не найден в МС.`);
  }

  const items = await fetchOrderPositions(order.id);
  const positions = items
    .filter((it) => it.ms_product_id)
    .map((it) => ({
      assortment: msHref('product', it.ms_product_id),
      quantity: it.quantity,
      price: Math.round((it.unit_price || 0) * 100),
    }));
  if (!positions.length) throw new Error('У заказа нет позиций с привязкой к МС');

  const body = {
    organization: msHref('organization', cfg.organization_id),
    name: order.reference_number
      ? `CRM-${order.id}/списание/${order.reference_number}`
      : `CRM-${order.id}/списание`,
    description: `Списание по CRM #${order.id}${order.cancel_reason ? ' · ' + order.cancel_reason : ''}`,
    positions,
  };
  if (storeId) body.store = msHref('store', storeId);
  return body;
}

export async function lossCreateHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);
  if (order.ms_loss_id) return { ms_document_id: order.ms_loss_id };

  const body = await buildLossBody(token, order);
  const result = await msCreate(token, 'loss', body);
  await db.run('UPDATE orders SET ms_loss_id = ? WHERE id = ?', result.id, order.id);
  return { ms_document_id: result.id };
}

// --- Markdown (уценка): создание новых товаров в МС + оприходование на склад уценки ---

const MARKDOWN_STORE_NAME = 'Склад МСК (Электросталь) УЦЕНКА';

export async function markdownCreateHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);

  const cfg = await getMsConfig();
  if (!cfg.organization_id) throw new Error('МС не инициализирован: нет organization_id');
  const storeId = cfg.store_map?.[MARKDOWN_STORE_NAME];
  if (!storeId) {
    throw new Error(`Склад «${MARKDOWN_STORE_NAME}» не найден в МС. Создайте его в МС и переинициализируйте конфиг.`);
  }
  const counterpartyId = await resolveManagerCounterparty(token, order.manager_id);
  if (!counterpartyId) throw new Error('Не удалось определить контрагента');

  const markdownIds = job.payload?.markdown_product_ids || [];
  if (!markdownIds.length) throw new Error('В задаче не указаны уценённые товары');

  const mdRows = await db.all(
    `SELECT p.*, parent.external_id AS parent_ms_id, parent.name AS parent_name
     FROM products p
     LEFT JOIN products parent ON parent.id = p.markdown_of_product_id
     WHERE p.id = ANY(?)`,
    markdownIds,
  );

  // Создаём в МС товары для уценок (если ещё не созданы).
  for (const md of mdRows) {
    if (md.external_id) continue; // уже создан
    const created = await msCreate(token, 'product', {
      name: md.name,
      code: md.sku || undefined,
      article: md.sku || undefined,
      description: `Уценка из CRM (заказ #${order.id}). Цену проставит админ.${md.parent_ms_id ? ' Исходный товар: ' + md.parent_name : ''}`,
      buyPrice: { value: Math.round((md.cost_price || 0) * 100), currency: msHref('currency', cfg.currency_id) },
    }).catch(async (e) => {
      // Если МС требует currency и его нет в кэше — пробуем без buyPrice.
      const retryBody = {
        name: md.name,
        code: md.sku || undefined,
        article: md.sku || undefined,
        description: `Уценка из CRM (заказ #${order.id}).`,
      };
      return await msCreate(token, 'product', retryBody);
    });
    await db.run(
      `UPDATE products SET external_source = 'moysklad', external_id = ?, updated_at = NOW() WHERE id = ?`,
      created.id,
      md.id,
    );
    md.external_id = created.id;
  }

  // Создаём customerreturn на склад уценки с этими товарами.
  if (order.ms_return_id) {
    return { ms_document_id: order.ms_return_id };
  }
  const positions = mdRows
    .filter((md) => md.external_id)
    .map((md) => ({
      assortment: msHref('product', md.external_id),
      quantity: md.stock || 1,
      // Цена 0 — её админ потом проставит в каталоге, и МС не нужно знать о ней
      // в момент оприходования (это не отгрузка, а приход).
      price: 0,
    }));
  if (!positions.length) throw new Error('Не удалось создать ни одного уценочного товара в МС');

  const body = {
    organization: msHref('organization', cfg.organization_id),
    agent: msHref('counterparty', counterpartyId),
    store: msHref('store', storeId),
    name: `CRM-${order.id}/уценка`,
    description: `Уценка из CRM #${order.id}. Фото-пруф в CRM.`,
    positions,
  };
  if (order.ms_demand_id) body.demand = msHref('demand', order.ms_demand_id);

  const result = await msCreate(token, 'salesreturn', body);
  await db.run('UPDATE orders SET ms_return_id = ? WHERE id = ?', result.id, order.id);
  return { ms_document_id: result.id };
}
