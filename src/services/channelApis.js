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
      const barcodes = [];
      for (const s of (c.sizes || [])) {
        for (const sku of (s.skus || [])) barcodes.push(sku);
      }
      if (!barcodes.length) {
        out.push({ channel_barcode: null, channel_sku: vendorCode, channel_name: name, channel_extra: { nmID } });
      } else {
        for (const bc of barcodes) {
          out.push({ channel_barcode: String(bc), channel_sku: vendorCode, channel_name: name, channel_extra: { nmID } });
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
