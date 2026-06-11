// Клиент МойСклад API (https://dev.moysklad.ru/doc/api/remap/1.2/).
// Используется для импорта товаров. Авторизация — Bearer-токен в MOYSKLAD_TOKEN.

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const PAGE_SIZE = 1000;

function authHeader(token) {
  if (!token) throw new Error('MOYSKLAD_TOKEN не задан');
  const t = String(token).trim();
  if (/[^\x00-\xFF]/.test(t)) {
    throw new Error(
      'Токен МойСклад содержит недопустимые символы (похоже, вставлен не сам токен). Скопируйте только токен — это строка из латинских букв и цифр.',
    );
  }
  return { Authorization: `Bearer ${t}`, Accept: 'application/json;charset=utf-8' };
}

async function msFetch(url, headers, retries = 4) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
    if ((res.status !== 429 && res.status !== 503) || attempt >= retries) return res;
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const waitMs = Number.isFinite(retryAfter)
      ? Math.min(10000, retryAfter * 1000)
      : Math.min(6000, 600 * 2 ** attempt);
    try {
      await res.text();
    } catch {
      // тело не важно — освобождаем соединение перед повтором
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function msError(status, text) {
  if (status === 429) {
    return new Error(
      'МойСклад: превышен лимит одновременных запросов. Подождите несколько секунд и повторите.',
    );
  }
  // Раньше обрезали 200 символов — этого мало чтобы видеть все ошибки позиций
  // в документах. С 1500 символов помещается и подробный errors[] и moreInfo.
  return new Error(`МойСклад ответил ${status}: ${text.slice(0, 1500)}`);
}

async function fetchAll(endpoint, token, pageSize = PAGE_SIZE) {
  const headers = authHeader(token);
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE}${endpoint}${sep}limit=${pageSize}&offset=${offset}`;
    const res = await msFetch(url, headers);
    if (!res.ok) {
      const text = await res.text();
      throw msError(res.status, text);
    }
    const data = await res.json();
    const rows = data.rows || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function hasMsImage(images) {
  return (images?.rows || []).length > 0;
}

function mapSalePrices(salePrices) {
  return (salePrices || []).map((sp) => ({
    name: sp.priceType?.name || 'Цена',
    value: (sp.value || 0) / 100,
  }));
}

function mapProduct(p, supplierMap) {
  const supplierId = extractUuid(p.supplier?.meta?.href);
  const supplier = p.supplier?.name || (supplierId && supplierMap ? supplierMap.get(supplierId) : null) || null;
  return {
    externalId: p.id,
    sku: p.article || p.code || null,
    name: p.name,
    costPrice: (p.buyPrice?.value || 0) / 100,
    defaultPrice: p.salePrices?.[0]?.value ? p.salePrices[0].value / 100 : 0,
    salePrices: mapSalePrices(p.salePrices),
    imageUrl: hasMsImage(p.images) ? `/api/products/external/${p.id}/image` : null,
    unit: p.uom?.name || 'шт',
    description: p.description || null,
    supplier,
  };
}

function extractUuid(href) {
  if (!href) return null;
  const path = href.split('?')[0];
  return path.split('/').pop();
}

function mapVariant(v, productById) {
  const parentId = extractUuid(v.product?.meta?.href);
  const parent = parentId ? productById.get(parentId) : null;

  const ownSalePrices = mapSalePrices(v.salePrices);
  const ownHasImage = hasMsImage(v.images);
  const buy = (v.buyPrice?.value || 0) / 100;

  const baseCode = v.article || v.code || parent?.sku || null;
  const charSuffix = (v.characteristics || []).map((c) => c.value).filter(Boolean).join('/');
  const sku = baseCode
    ? (charSuffix ? `${baseCode}/${charSuffix}` : `${baseCode}/${v.id.slice(0, 8)}`)
    : null;

  return {
    externalId: v.id,
    sku,
    name: v.name,
    costPrice: buy || parent?.costPrice || 0,
    defaultPrice: ownSalePrices[0]?.value ?? parent?.defaultPrice ?? 0,
    salePrices: ownSalePrices.length ? ownSalePrices : (parent?.salePrices || []),
    imageUrl: ownHasImage ? `/api/products/external/${v.id}/image` : (parent?.imageUrl || null),
    unit: parent?.unit || 'шт',
    description: parent?.description || null,
    supplier: parent?.supplier || null,
  };
}

export async function fetchMoyskladProducts(token) {
  let supplierMap = new Map();
  try {
    const agents = await fetchAll('/entity/counterparty', token);
    supplierMap = new Map(agents.map((a) => [a.id, a.name]));
  } catch {
    // не критично — товары импортируются без поставщика
  }

  const productRows = await fetchAll('/entity/product?expand=images.miniature', token, 100);
  const products = productRows.map((p) => mapProduct(p, supplierMap));
  const productById = new Map(products.map((p) => [p.externalId, p]));

  const variantRows = await fetchAll('/entity/variant?expand=images.miniature', token, 100);
  const variants = variantRows.map((v) => mapVariant(v, productById));

  return [...products, ...variants];
}

export async function fetchMoyskladStock(token) {
  const rows = await fetchAll('/report/stock/all', token);
  const byId = new Map();
  const bySku = new Map();
  for (const r of rows) {
    const stock = Number(r.stock) || 0;
    const id = extractUuid(r.meta?.href);
    if (id) byId.set(id, stock);
    const sku = r.article || r.code;
    if (sku) bySku.set(String(sku), stock);
  }
  return { byId, bySku, count: rows.length, sample: rows[0] || null };
}

// Свежие остатки по складам для списка UUID. В МС остатки лежат на разных
// сущностях — product / variant / consignment, — поэтому фильтр строим
// сразу обоими: `product=URL1;variant=URL1;product=URL2;variant=URL2;...`.
// Раньше слали только product=, и все товары-модификации (например
// «Q20176/70868033») возвращали пустой результат и наш импорт обнулял им
// stock_by_store. (Инцидент 2026-06-11 с ТРУФАСТ Контейнером.)
//
// МС-фильтр поддерживает OR через `;`, ограничения у нас 1500 символов
// на batch (msError усекает текст до 1500). 50 ID × 2 = 100 значений по
// ~80 символов = ~8 КБ — в пределах безопасного URL-лимита.
export async function msFetchStockByProductIds(token, externalIds) {
  if (!externalIds?.length) return new Map();
  const headers = authHeader(token);
  const filterParts = externalIds.flatMap((id) => [
    `product=${BASE}/entity/product/${id}`,
    `variant=${BASE}/entity/variant/${id}`,
  ]).join(';');
  const url = `${BASE}/report/stock/bystore?filter=${encodeURIComponent(filterParts)}&limit=1000`;
  const res = await msFetch(url, headers);
  if (!res.ok) {
    const text = await res.text();
    throw msError(res.status, text);
  }
  const data = await res.json();
  const byId = new Map();
  for (const r of (data.rows || [])) {
    const stores = (r.stockByStore || []).map((s) => ({
      store: s.name || '—',
      stock: Number(s.stock) || 0,
      reserve: Number(s.reserve) || 0,
    }));
    const id = extractUuid(r.meta?.href);
    if (id) byId.set(id, stores);
  }
  return byId;
}

export async function fetchMoyskladStockByStorePage(token, offset = 0, limit = 500) {
  const headers = authHeader(token);
  const url = `${BASE}/report/stock/bystore?limit=${limit}&offset=${offset}`;
  const res = await msFetch(url, headers);
  if (!res.ok) {
    const text = await res.text();
    throw msError(res.status, text);
  }
  const data = await res.json();
  const rows = data.rows || [];
  const byId = new Map();
  const bySku = new Map();
  for (const r of rows) {
    const stores = (r.stockByStore || []).map((s) => ({
      store: s.name || '—',
      stock: Number(s.stock) || 0,
      reserve: Number(s.reserve) || 0,
    }));
    if (!stores.length) continue;
    const id = extractUuid(r.meta?.href);
    if (id) byId.set(id, stores);
    const sku = r.article || r.code;
    if (sku) bySku.set(String(sku), stores);
  }
  const samples = rows.slice(0, 3).map((r) => ({
    code: r.code ?? null,
    article: r.article ?? null,
    uuid: extractUuid(r.meta?.href),
    storeCount: (r.stockByStore || []).length,
    stores: (r.stockByStore || []).map((s) => ({
      name: s.name ?? null,
      stock: Number(s.stock) ?? null,
      reserve: Number(s.reserve) ?? null,
    })),
  }));

  const firstRowFull = rows[0] ? JSON.stringify(rows[0], null, 2) : null;
  console.log(
    `[moysklad] /report/stock/bystore: ${rows.length} rows, ` +
    `byId.size=${byId.size}, bySku.size=${bySku.size}, ` +
    `first row keys=${rows[0] ? Object.keys(rows[0]).join(', ') : 'N/A'}`,
  );
  if (firstRowFull) console.log('[moysklad] first row:', firstRowFull);

  return { byId, bySku, samples, size: data.meta?.size ?? offset + rows.length, fetched: rows.length, rowCount: rows.length };
}

async function msRequest(method, endpoint, token, body) {
  const headers = { ...authHeader(token), 'Content-Type': 'application/json' };
  const url = `${BASE}${endpoint}`;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    if ((res.status !== 429 && res.status !== 503) || attempt >= 4) {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw msError(res.status, text);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const waitMs = Number.isFinite(retryAfter)
      ? Math.min(10000, retryAfter * 1000)
      : Math.min(6000, 600 * 2 ** attempt);
    await res.text().catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function msFetchStores(token) {
  const rows = await fetchAll('/entity/store', token);
  return rows.map((s) => ({ id: s.id, name: s.name, archived: !!s.archived }));
}

export async function msFetchOrganizations(token) {
  const rows = await fetchAll('/entity/organization', token);
  return rows.filter((o) => !o.archived).map((o) => ({ id: o.id, name: o.name }));
}

export async function msFindCounterpartyByName(token, name) {
  const enc = encodeURIComponent(name);
  const rows = await fetchAll(`/entity/counterparty?filter=name=${enc}`, token);
  return rows.map((c) => ({ id: c.id, name: c.name }));
}

export async function msFindProjectByName(token, name) {
  const enc = encodeURIComponent(name);
  const rows = await fetchAll(`/entity/project?filter=name=${enc}`, token);
  return rows.map((p) => ({ id: p.id, name: p.name }));
}

export function msHref(entity, id) {
  return {
    meta: {
      href: `${BASE}/entity/${entity}/${id}`,
      type: entity,
      mediaType: 'application/json',
    },
  };
}

export async function msCreate(token, entity, body) {
  return await msRequest('POST', `/entity/${entity}`, token, body);
}

export async function msUpdate(token, entity, id, body) {
  return await msRequest('PUT', `/entity/${entity}/${id}`, token, body);
}

export async function msDelete(token, entity, id) {
  return await msRequest('DELETE', `/entity/${entity}/${id}`, token);
}

export async function msUploadProductImage(token, productId, base64DataUrl, filenameHint = 'photo') {
  const m = String(base64DataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error('Невалидный data URL — нужно data:image/...;base64,...');
  const ext = m[1].split('/')[1] || 'jpg';
  const filename = filenameHint.includes('.') ? filenameHint : `${filenameHint}.${ext}`;
  return await msRequest('POST', `/entity/product/${productId}/images`, token, [
    { filename, content: m[2] },
  ]);
}

export async function msAttachFile(token, entityType, entityId, base64DataUrl, filenameHint = 'file') {
  const m = String(base64DataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Невалидный data URL');
  const ext = (m[1].split('/')[1] || 'bin').split('+')[0];
  const filename = filenameHint.includes('.') ? filenameHint : `${filenameHint}.${ext}`;
  return await msRequest('POST', `/entity/${entityType}/${entityId}/files`, token, [
    { filename, content: m[2] },
  ]);
}
