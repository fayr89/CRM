// Клиенты API маркетплейсов для подтяжки номенклатуры канала (Phase 3).
// Пока — WB (первый канал). Возвращают плоский список позиций канала для
// matching с внутренней номенклатурой: { channel_barcode, channel_sku,
// channel_name, channel_extra }.
//
// Работает только при наличии реального API-ключа (заводится в справочнике
// «Каналы»). Без ключа/при ошибке — бросаем понятную ошибку, ничего не ломаем.

// ===================== WB Marketplace API (ФБС) =====================
// База marketplace-api.wildberries.ru. Токен WB (категория Marketplace) —
// напрямую в заголовке Authorization. Эндпоинты — как в ТЗ 5.1 (v3).
const WB_MP_BASE = 'https://marketplace-api.wildberries.ru';

async function wbMpFetch(key, method, path, body) {
  if (!key) throw new Error('Не задан API-ключ WB');
  let res;
  try {
    res = await fetch(`${WB_MP_BASE}${path}`, {
      method,
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error('WB API недоступен: ' + (e?.message || e));
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`WB API ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Новые сборочные задания (GET /api/v3/orders/new).
export async function wbNewOrders(key) {
  const d = await wbMpFetch(key, 'GET', '/api/v3/orders/new');
  return (d?.orders || []).map((o) => ({
    order_id: String(o.id ?? o.orderUid ?? ''),
    article: o.article ?? null,
    barcode: Array.isArray(o.skus) ? (o.skus[0] ?? null) : null,
    name: o.article ?? null,
    price: o.price ?? null,
    created_at: o.createdAt ?? null,
  }));
}

// Создать пустую поставку (POST /api/v3/supplies) → { id }.
export async function wbCreateSupply(key, name) {
  const d = await wbMpFetch(key, 'POST', '/api/v3/supplies', { name: name || 'Поставка CRM' });
  return d?.id || d?.supplyId || null;
}

// Привязать сборочное задание к поставке (PATCH .../orders/{orderId}).
export async function wbAddOrderToSupply(key, supplyId, orderId) {
  await wbMpFetch(key, 'PATCH', `/api/v3/supplies/${encodeURIComponent(supplyId)}/orders/${encodeURIComponent(orderId)}`);
  return true;
}

// Штрихкод/QR поставки (GET .../barcode?type=svg|png) → { barcode, file(base64) }.
export async function wbSupplyBarcode(key, supplyId, type = 'svg') {
  const d = await wbMpFetch(key, 'GET', `/api/v3/supplies/${encodeURIComponent(supplyId)}/barcode?type=${type}`);
  return { barcode: d?.barcode ?? null, file: d?.file ?? null, type };
}

// Состав поставки (GET .../orders).
export async function wbSupplyOrders(key, supplyId) {
  const d = await wbMpFetch(key, 'GET', `/api/v3/supplies/${encodeURIComponent(supplyId)}/orders`);
  return d?.orders || [];
}

// Передать поставку в доставку (PATCH .../deliver).
export async function wbDeliverSupply(key, supplyId) {
  await wbMpFetch(key, 'PATCH', `/api/v3/supplies/${encodeURIComponent(supplyId)}/deliver`);
  return true;
}

// Повторная отгрузка непринятых при приёмке (GET /api/v3/supplies/orders/reshipment).
export async function wbReshipmentOrders(key) {
  const d = await wbMpFetch(key, 'GET', '/api/v3/supplies/orders/reshipment');
  return d?.orders || d?.next || [];
}

// ===================== WB Supplies API (ФБО — приёмка на склад маркетплейса) =====================
// Отдельный host supplies-api.wildberries.ru, но авторизация та же (WB-токен).
const WB_SUPPLIES_BASE = 'https://supplies-api.wildberries.ru';

async function wbSuppliesFetch(key, method, path) {
  if (!key) throw new Error('Не задан API-ключ WB');
  let res;
  try {
    res = await fetch(`${WB_SUPPLIES_BASE}${path}`, {
      method,
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Error('WB Supplies API недоступен: ' + (e?.message || e));
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`WB Supplies API ${res.status}: ${text.slice(0, 500)}`);
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Список складов приёмки WB (куда можно везти ФБО-поставку).
// GET /api/v1/warehouses → массив {ID, name, address, workTime, acceptsQR, ...}.
export async function wbFboListWarehouses(key) {
  const d = await wbSuppliesFetch(key, 'GET', '/api/v1/warehouses');
  const rows = Array.isArray(d) ? d : (d?.warehouses || d?.data || []);
  return rows.map((w) => ({
    id: w.ID ?? w.id ?? null,
    name: w.name || null,
    address: w.address || null,
    workTime: w.workTime || null,
    acceptsQR: !!w.acceptsQR,
  })).filter((w) => w.id != null);
}

// Коэффициенты приёмки по складу(-ам). Ответ на 14 дней вперёд по каждому складу
// и типу коробов. coefficient: -1 = недоступно, 0 = бесплатно, >0 = платно (кратно базе).
// GET /api/v1/acceptance/coefficients?warehouseIDs=1,2,3
export async function wbFboAcceptanceCoefficients(key, warehouseIDs) {
  const ids = Array.isArray(warehouseIDs) ? warehouseIDs.filter(Boolean).join(',') : String(warehouseIDs || '');
  const path = ids ? `/api/v1/acceptance/coefficients?warehouseIDs=${encodeURIComponent(ids)}` : '/api/v1/acceptance/coefficients';
  const d = await wbSuppliesFetch(key, 'GET', path);
  const rows = Array.isArray(d) ? d : (d?.data || []);
  return rows.map((r) => ({
    date: r.date || null,
    coefficient: r.coefficient != null ? Number(r.coefficient) : null,
    warehouseID: r.warehouseID ?? r.warehouseId ?? null,
    warehouseName: r.warehouseName || null,
    boxTypeName: r.boxTypeName || null,
    allowUnload: r.allowUnload !== false,
    storageCoef: r.storageCoef != null ? Number(r.storageCoef) : null,
    deliveryCoef: r.deliveryCoef != null ? Number(r.deliveryCoef) : null,
    isSortingCenter: !!r.isSortingCenter,
  }));
}

// WB Content API: список карточек товара (номенклатура продавца).
// Авторизация — ключ напрямую в заголовке Authorization (без Bearer).
//
// ВАЖНО: эндпоинт КУРСОРНЫЙ. За один запрос отдаёт максимум ~100 карточек
// (WB игнорирует limit>100). Чтобы получить весь каталог, надо листать: брать
// из ответа cursor.updatedAt + cursor.nmID и слать их в следующем запросе, пока
// cursor.total (кол-во карточек в ответе) не станет меньше лимита страницы.
// Раньше делался ОДИН запрос без пагинации → тянулась только первая сотня карточек
// (у продавца с бо́льшим каталогом остальное молча терялось).
export async function fetchWbCards(apiKey, { limit = 100, maxPages = 100 } = {}) {
  if (!apiKey) throw new Error('Не задан API-ключ WB');
  const url = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
  const pageLimit = Math.min(100, Math.max(1, limit)); // WB cursor.limit максимум 100
  const out = [];
  let cursor = { limit: pageLimit };
  for (let page = 0; page < maxPages; page += 1) {
    const body = { settings: { cursor, filter: { withPhoto: -1 } } };
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new Error('WB API недоступен: ' + (e?.message || e));
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`WB API ${res.status}: ${text.slice(0, 300)}`);
    }
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('WB API: не JSON'); }
    const cards = data?.cards || [];
    for (const c of cards) {
      const vendorCode = c.vendorCode || null;
      const name = c.title || c.subjectName || vendorCode || null;
      const nmID = c.nmID ?? null;
      // Габариты карточки WB (см): length/width/height.
      const d = c.dimensions || {};
      const dimL = Number(d.length) || null;
      const dimW = Number(d.width) || null;
      const dimH = Number(d.height) || null;
      const base = { channel_name: name, channel_extra: { nmID }, channel_dim_l: dimL, channel_dim_w: dimW, channel_dim_h: dimH };
      const barcodes = [];
      for (const s of (c.sizes || [])) {
        for (const sku of (s.skus || [])) barcodes.push(sku);
      }
      if (!barcodes.length) {
        out.push({ ...base, channel_barcode: null, channel_sku: vendorCode });
      } else {
        for (const bc of barcodes) {
          out.push({ ...base, channel_barcode: String(bc), channel_sku: vendorCode });
        }
      }
    }
    // Пагинация по курсору: WB возвращает cursor.total = число карточек в ЭТОМ
    // ответе. Меньше лимита страницы (или пусто) — это последняя страница.
    const rc = data?.cursor || {};
    const got = Number.isFinite(Number(rc.total)) ? Number(rc.total) : cards.length;
    if (!cards.length || got < pageLimit) break;
    if (rc.updatedAt == null || rc.nmID == null) break; // нет курсора для следующей страницы
    cursor = { limit: pageLimit, updatedAt: rc.updatedAt, nmID: rc.nmID };
  }
  return out;
}

// ===================== Ozon Seller API =====================
// Учётка Ozon = Client-Id + Api-Key (оба обязательны). Храним как JSON
// {"client_id":"...","api_key":"..."} в api_key_enc; парсим гибко.
export function parseOzonCreds(plain) {
  if (!plain) throw new Error('Не задан ключ Ozon (нужны Client-Id + Api-Key)');
  const s = String(plain).trim();
  try {
    const j = JSON.parse(s);
    const clientId = j.client_id || j.clientId || j.ClientId;
    const apiKey = j.api_key || j.apiKey || j.ApiKey;
    if (clientId && apiKey) return { clientId: String(clientId), apiKey: String(apiKey) };
  } catch { /* не JSON */ }
  // Формат «client_id:api_key»
  const m = s.match(/^([^\s:]+)\s*[:|]\s*(.+)$/);
  if (m) return { clientId: m[1].trim(), apiKey: m[2].trim() };
  throw new Error('Ozon: неверный формат ключа. Ожидаю JSON {"client_id":"...","api_key":"..."} или «client_id:api_key»');
}

// Список товаров Ozon (POST /v3/product/list, курсорный: last_id + total)
// → батч POST /v3/product/info/list за деталями (barcode, offer_id, dimensions).
export async function fetchOzonCards(plain, { pageSize = 200, maxPages = 200 } = {}) {
  const { clientId, apiKey } = parseOzonCreds(plain);
  const listUrl = 'https://api-seller.ozon.ru/v3/product/list';
  const infoUrl = 'https://api-seller.ozon.ru/v3/product/info/list';
  const headers = { 'Client-Id': clientId, 'Api-Key': apiKey, 'Content-Type': 'application/json' };
  const out = [];
  let lastId = '';
  let firstPageRaw = null;
  let pagesFetched = 0;
  for (let page = 0; page < maxPages; page += 1) {
    let listRes;
    try {
      listRes = await fetch(listUrl, {
        method: 'POST', headers,
        body: JSON.stringify({ filter: { visibility: 'ALL' }, last_id: lastId, limit: pageSize }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) { throw new Error('Ozon API недоступен: ' + (e?.message || e)); }
    const text = await listRes.text().catch(() => '');
    if (!listRes.ok) throw new Error(`Ozon API ${listRes.status}: ${text.slice(0, 500)}`);
    const listData = text ? JSON.parse(text) : {};
    if (page === 0) firstPageRaw = listData;
    // Разные версии Ozon возвращают items в result.items или items.
    const items = listData?.result?.items || listData?.items || [];
    pagesFetched += 1;
    if (!items.length) break;
    // Детали: батч по product_id (максимум 1000 на запрос).
    const productIds = items.map((x) => x.product_id).filter(Boolean);
    let infoItems = [];
    if (productIds.length) {
      let infoRes;
      try {
        infoRes = await fetch(infoUrl, {
          method: 'POST', headers,
          body: JSON.stringify({ product_id: productIds, offer_id: [], sku: [] }),
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) { throw new Error('Ozon API недоступен (info): ' + (e?.message || e)); }
      const infoText = await infoRes.text().catch(() => '');
      if (infoRes.ok) {
        const infoData = infoText ? JSON.parse(infoText) : {};
        infoItems = infoData?.result?.items || infoData?.items || [];
      }
    }
    const byId = new Map(infoItems.map((i) => [i.id ?? i.product_id, i]));
    for (const it of items) {
      const info = byId.get(it.product_id) || {};
      const offerId = it.offer_id || info.offer_id || null;
      const name = info.name || offerId || null;
      // Габариты Ozon (мм) → см.
      const mm = (x) => (x != null && Number(x) > 0 ? Number(x) / 10 : null);
      const dimL = mm(info.depth) || mm(info.length);
      const dimW = mm(info.width);
      const dimH = mm(info.height);
      const base = { channel_name: name, channel_extra: { product_id: it.product_id }, channel_dim_l: dimL, channel_dim_w: dimW, channel_dim_h: dimH };
      // На Ozon «артикул канала» = штрихкод; «SKU канала» = offer_id (правило маппинга).
      const barcodes = [];
      if (info.barcode) barcodes.push(String(info.barcode));
      if (Array.isArray(info.barcodes)) for (const b of info.barcodes) if (b) barcodes.push(String(b));
      if (!barcodes.length) {
        out.push({ ...base, channel_barcode: null, channel_sku: offerId });
      } else {
        for (const bc of barcodes) out.push({ ...base, channel_barcode: bc, channel_sku: offerId });
      }
    }
    // Пагинация: last_id из ответа. Пусто — конец.
    lastId = listData?.result?.last_id || listData?.last_id || '';
    if (!lastId || items.length < pageSize) break;
  }
  if (!out.length && pagesFetched > 0) {
    const keys = Object.keys(firstPageRaw || {}).slice(0, 10).join(', ');
    throw new Error(`Ozon API ответил без товаров. Проверь Client-Id и Api-Key. Ключи ответа: [${keys}]. Начало: ${JSON.stringify(firstPageRaw).slice(0, 300)}`);
  }
  return out;
}

// ===================== Yandex Market Partner API =====================
// Учётка ЯМ = OAuth-токен + business_id. Храним как JSON
// {"token":"...","business_id":"..."} в api_key_enc.
export function parseYmCreds(plain) {
  if (!plain) throw new Error('Не задан ключ ЯМ (нужны токен + business_id)');
  const s = String(plain).trim();
  let businessId = null; let token = null;
  try {
    const j = JSON.parse(s);
    token = j.token || j.oauth || j.Token || null;
    businessId = j.business_id || j.businessId || j.BusinessId || null;
  } catch { /* не JSON — разбираем как строку «a:b» */ }
  if (!businessId || !token) {
    const m = s.match(/^([^\s:|]+)\s*[:|]\s*(.+)$/);
    if (m) {
      // Автоопределение: business_id — только цифры; вторая часть — токен.
      const a = m[1].trim(); const b = m[2].trim();
      if (/^\d+$/.test(a)) { businessId = a; token = b; }
      else if (/^\d+$/.test(b)) { businessId = b; token = a; }
      else { businessId = a; token = b; }
    }
  }
  if (!businessId || !token) {
    throw new Error('ЯМ: неверный формат ключа. Ожидаю JSON {"token":"...","business_id":"..."} или строку «business_id:token» (business_id — число из кабинета).');
  }
  if (!/^\d+$/.test(String(businessId).trim())) {
    throw new Error(`ЯМ: business_id должен быть ЧИСЛОМ (у тебя «${businessId}»). Возьми его в кабинете ЯМ: Настройки → Настройки API → «Идентификатор бизнес-аккаунта». Не путай с логином, кампанией или названием магазина.`);
  }
  return { token: String(token).trim(), businessId: String(businessId).trim() };
}

// Товары продавца ЯМ: POST /businesses/{businessId}/offer-mappings — постранично
// по page_token (курсор). Ответ содержит offer с barcodes и weightDimensions (см).
// Формат ответа v2 API убрал обёртку `result` — берём и с обёрткой, и без.
export async function fetchYmCards(plain, { pageSize = 200, maxPages = 200 } = {}) {
  const { token, businessId } = parseYmCreds(plain);
  const url = `https://api.partner.market.yandex.ru/businesses/${encodeURIComponent(businessId)}/offer-mappings?limit=${pageSize}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const out = [];
  let pageToken = '';
  let pagesFetched = 0;
  let firstPageRaw = null; // на случай, если пришло 0 — покажем сырой ответ для диагностики
  for (let page = 0; page < maxPages; page += 1) {
    let res;
    const u = pageToken ? `${url}&page_token=${encodeURIComponent(pageToken)}` : url;
    try {
      res = await fetch(u, {
        method: 'POST', headers,
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) { throw new Error('ЯМ API недоступен: ' + (e?.message || e)); }
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`ЯМ API ${res.status}: ${text.slice(0, 500)}`);
    const data = text ? JSON.parse(text) : {};
    if (page === 0) firstPageRaw = data;
    // v2 может отдавать offerMappings без result-обёртки; также встречается `offers`.
    const rows = data?.result?.offerMappings
      || data?.offerMappings
      || data?.result?.offers
      || data?.offers
      || [];
    pagesFetched += 1;
    if (!rows.length) break;
    for (const row of rows) {
      // row может быть { offer, mapping } или напрямую offer.
      const o = row?.offer || row || {};
      const offerId = o.offerId || o.shopSku || null;
      const name = o.name || offerId || null;
      const bcs = o.barcodes || o.gtin || [];
      const wd = o.weightDimensions || {};
      const base = {
        channel_name: name,
        channel_extra: { marketSku: row?.mapping?.marketSku || o.marketSku || null },
        channel_dim_l: wd.length != null ? Number(wd.length) : null,
        channel_dim_w: wd.width != null ? Number(wd.width) : null,
        channel_dim_h: wd.height != null ? Number(wd.height) : null,
      };
      const bcArr = Array.isArray(bcs) ? bcs : (bcs ? [bcs] : []);
      if (!bcArr.length) {
        out.push({ ...base, channel_barcode: null, channel_sku: offerId });
      } else {
        for (const bc of bcArr) out.push({ ...base, channel_barcode: String(bc), channel_sku: offerId });
      }
    }
    pageToken = data?.result?.paging?.nextPageToken || data?.paging?.nextPageToken || '';
    if (!pageToken) break;
  }
  if (!out.length && pagesFetched > 0) {
    const keys = Object.keys(firstPageRaw || {}).slice(0, 10).join(', ');
    throw new Error(`ЯМ API ответил без товаров. Проверь business_id и права токена. Ключи ответа: [${keys}]. Начало: ${JSON.stringify(firstPageRaw).slice(0, 300)}`);
  }
  return out;
}
