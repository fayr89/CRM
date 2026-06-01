// Высокоуровневая логика синхронизации заказов CRM ↔ customerorder в МС.
// Резолвит контрагента (по менеджеру заказа), собирает positions с product/store UUID,
// делает upsert: POST если нет ms_customer_order_id, PUT если есть.
import { db } from '../db.js';
import {
  msCreate, msUpdate, msDelete, msHref, msFindCounterpartyByName, msFindProjectByName,
  msUploadProductImage, msAttachFile,
} from './moysklad.js';
import { getMoyskladToken, getMsConfig, setMsSetting } from './ms-jobs.js';

// --- Project resolver: ищет Проект «CRM35» в МС один раз, кэширует UUID ---
const MS_PROJECT_NAME = 'CRM35';

async function resolveMsProject(token) {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.project_crm35_id'`).catch(() => null);
  if (row?.value) return String(row.value);
  const found = await msFindProjectByName(token, MS_PROJECT_NAME);
  if (!found.length) return null;
  await setMsSetting('moysklad.project_crm35_id', found[0].id);
  return found[0].id;
}

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

// Обновить локальные остатки и резервы в CRM сразу после успешной МС-операции.
// stockMul/reserveMul: -1 / 0 / +1, домножается на quantity позиции.
// Так пользователь видит актуальное состояние сразу, не ждёт ручного импорта
// (МС в /report/stock/* имеет лаг, плюс пересчёт всего отчёта медленный).
async function applyLocalStockReserveDelta(orderId, stockMul, reserveMul, warehouseOverride = null) {
  const order = await db.get('SELECT warehouse FROM orders WHERE id = ?', orderId);
  const warehouse = warehouseOverride || order?.warehouse || null;
  const items = await db.all(
    `SELECT oi.product_id, oi.quantity FROM order_items oi
     WHERE oi.order_id = ? AND oi.product_id IS NOT NULL`,
    orderId,
  );
  for (const it of items) {
    const stockDelta = stockMul * it.quantity;
    const reserveDelta = reserveMul * it.quantity;
    // Общий stock (только если меняется).
    if (stockDelta !== 0) {
      await db.run(
        `UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) + ?), updated_at = NOW()
         WHERE id = ?`,
        stockDelta,
        it.product_id,
      );
    }
    if (!warehouse) continue;
    const p = await db.get('SELECT stock_by_store FROM products WHERE id = ?', it.product_id);
    let sbs = Array.isArray(p?.stock_by_store) ? [...p.stock_by_store] : [];
    const idx = sbs.findIndex((s) => s.store === warehouse);
    if (idx >= 0) {
      const curStock = Number(sbs[idx].stock || 0);
      const curReserve = Number(sbs[idx].reserve || 0);
      sbs[idx] = {
        ...sbs[idx],
        stock: Math.max(0, curStock + stockDelta),
        reserve: Math.max(0, curReserve + reserveDelta),
      };
    } else if (stockDelta > 0 || reserveDelta > 0) {
      sbs.push({
        store: warehouse,
        stock: Math.max(0, stockDelta),
        reserve: Math.max(0, reserveDelta),
      });
    }
    await db.run(
      `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
      JSON.stringify(sbs),
      it.product_id,
    );
  }
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
  const projectId = await resolveMsProject(token).catch(() => null);
  if (projectId) body.project = msHref('project', projectId);

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
  // Локально обновляем reserve в stock_by_store: full → +qty, none → -qty.
  // stock не трогаем — товар физически на складе до отгрузки.
  if (reserveMode === 'full') {
    await applyLocalStockReserveDelta(order.id, 0, +1);
  } else if (reserveMode === 'none') {
    await applyLocalStockReserveDelta(order.id, 0, -1);
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
  const projectId = await resolveMsProject(token).catch(() => null);
  if (projectId) body.project = msHref('project', projectId);
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
  // Отгрузка: stock -1, reserve -1 (отгрузка снимает резерв и списывает товар).
  await applyLocalStockReserveDelta(order.id, -1, -1);
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
  // Откат отгрузки: stock +1, reserve +1 (резерв восстанавливается).
  await applyLocalStockReserveDelta(order.id, +1, +1);
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
  const projectId = await resolveMsProject(token).catch(() => null);
  if (projectId) body.project = msHref('project', projectId);
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
  // Прикрепляем фото-пруф состояния товара к документу возврата (если есть).
  // Не критично — если МС не примет файл, документ уже создан.
  if (order.return_proof) {
    await msAttachFile(token, 'salesreturn', result.id, order.return_proof, `return-proof-${order.id}`)
      .catch((e) => console.warn(`[ms] attach proof to salesreturn ${result.id}:`, e.message));
  }
  // Возврат: stock +1, reserve без изменений (товар не был зарезервирован).
  await applyLocalStockReserveDelta(order.id, +1, 0);
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
  const projectId = await resolveMsProject(token).catch(() => null);
  if (projectId) body.project = msHref('project', projectId);
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
  // Прикрепляем фото-пруф (товар негоден) к документу списания.
  if (order.return_proof) {
    await msAttachFile(token, 'loss', result.id, order.return_proof, `loss-proof-${order.id}`)
      .catch((e) => console.warn(`[ms] attach proof to loss ${result.id}:`, e.message));
  }
  // Списание: stock -1, reserve без изменений.
  await applyLocalStockReserveDelta(order.id, -1, 0);
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
  // buyPrice не передаём — currency UUID в нашем кэше нет, и без него МС валится.
  // Себестоимость и продажную цену проставит админ.
  for (const md of mdRows) {
    if (md.external_id) continue; // уже создан
    const created = await msCreate(token, 'product', {
      name: md.name,
      code: md.sku || undefined,
      article: md.sku || undefined,
      description: `Уценка из CRM (заказ #${order.id}). Цену проставит админ.${md.parent_ms_id ? ' Исходный товар: ' + md.parent_name : ''}`,
    });
    // Загружаем фото-пруф состояния в карточку товара (если есть). Не падаем если
    // не получилось — товар уже создан, картинку можно добавить вручную в МС.
    if (order.return_proof) {
      await msUploadProductImage(token, created.id, order.return_proof, `markdown-${order.id}-${md.id}`)
        .catch((e) => console.warn(`[ms] image upload to product ${created.id} failed:`, e.message));
    }
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
  // ВАЖНО: НЕ привязываем к demand — позиции новые (markdown-копии), которых
  // не было в исходной отгрузке. МС иначе валит 412 «позиция не соответствует».
  const projectId = await resolveMsProject(token).catch(() => null);
  if (projectId) body.project = msHref('project', projectId);

  const result = await msCreate(token, 'salesreturn', body);
  await db.run('UPDATE orders SET ms_return_id = ? WHERE id = ?', result.id, order.id);
  // Прикрепляем фото-пруф состояния товара к документу уценки в МС.
  if (order.return_proof) {
    await msAttachFile(token, 'salesreturn', result.id, order.return_proof, `markdown-proof-${order.id}`)
      .catch((e) => console.warn(`[ms] attach proof to salesreturn ${result.id}:`, e.message));
  }
  return { ms_document_id: result.id };
}

// Откат списания (loss): удаляет документ «Списание» в МС, возвращает остатки в CRM,
// очищает ms_loss_id и сбрасывает return_status в 'pending' — админ может выбрать
// другой вариант (В сток / Уценка / Потерян / повторить списание).
export async function lossUndoHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);

  if (order.ms_loss_id) {
    try {
      await msDelete(token, 'loss', order.ms_loss_id);
    } catch (e) {
      console.warn(`[ms] delete loss ${order.ms_loss_id}:`, e.message);
    }
  }
  // Восстанавливаем сток локально (списание убрало -1, откат возвращает +1).
  await applyLocalStockReserveDelta(order.id, +1, 0);
  // Сбрасываем resolution: заказ снова в режиме «возврат ожидает решения».
  await db.run(
    `UPDATE orders SET ms_loss_id = NULL, return_status = 'pending',
     return_resolved_by = NULL, return_resolved_at = NULL, updated_at = NOW()
     WHERE id = ?`,
    order.id,
  );
  return { ms_document_id: null };
}

// Откат возврата (customerreturn / salesreturn для resolution='restocked'):
// удаляет документ возврата в МС, убирает локальный сток (+1, который был добавлен
// при оприходовании), сбрасывает return_status в 'pending'.
export async function customerReturnUndoHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);

  if (order.ms_return_id) {
    try {
      await msDelete(token, 'salesreturn', order.ms_return_id);
    } catch (e) {
      console.warn(`[ms] delete salesreturn ${order.ms_return_id}:`, e.message);
    }
  }
  // Восстановили сток при оприходовании (+1), откат — снимаем (-1).
  await applyLocalStockReserveDelta(order.id, -1, 0);
  await db.run(
    `UPDATE orders SET ms_return_id = NULL, return_status = 'pending',
     return_resolved_by = NULL, return_resolved_at = NULL, updated_at = NOW()
     WHERE id = ?`,
    order.id,
  );
  return { ms_document_id: null };
}

// Откат уценки: удаляет в МС возвратный документ и архивирует созданные товары,
// в CRM деактивирует markdown-products и возвращает заказ в return_status='pending'
// (можно выбрать другой resolution — В сток / Списать / Потерян / повторить уценку).
export async function markdownUndoHandler(job) {
  const token = await getMoyskladToken();
  if (!token) throw new Error('Токен МС не настроен');
  const order = await db.get('SELECT * FROM orders WHERE id = ?', job.order_id);
  if (!order) throw new Error(`Заказ #${job.order_id} не найден`);

  // 1) Удаляем salesreturn в МС.
  if (order.ms_return_id) {
    try {
      await msDelete(token, 'salesreturn', order.ms_return_id);
    } catch (e) {
      console.warn(`[ms] delete salesreturn ${order.ms_return_id}:`, e.message);
    }
  }
  // 2) Удаляем (или архивируем) markdown-товары в МС.
  const mdRows = await db.all(
    `SELECT id, external_id, name FROM products WHERE markdown_order_id = ? AND is_markdown = TRUE`,
    order.id,
  );
  for (const md of mdRows) {
    if (!md.external_id) continue;
    try {
      await msDelete(token, 'product', md.external_id);
    } catch (e) {
      // МС не даёт удалить товар с историей — архивируем.
      try {
        await msUpdate(token, 'product', md.external_id, { archived: true });
      } catch (e2) {
        console.warn(`[ms] archive product ${md.external_id}:`, e2.message);
      }
    }
  }
  // 3) В CRM: маркируем markdown-products как inactive (для аудита оставляем запись).
  await db.run(
    `UPDATE products SET active = FALSE, updated_at = NOW()
     WHERE markdown_order_id = ? AND is_markdown = TRUE`,
    order.id,
  );
  // 4) Возвращаем заказ в return_status='pending' — менеджер выберет другое решение.
  await db.run(
    `UPDATE orders SET return_status = 'pending', return_proof = NULL,
     return_resolved_by = NULL, return_resolved_at = NULL,
     ms_return_id = NULL, updated_at = NOW()
     WHERE id = ?`,
    order.id,
  );
  return {};
}
