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

// Комплекты (bundle) из МойСклад = «сеты». Тянем список (с папкой), для каждого —
// состав (components). folderName — фильтр по названию папки (напр. «Комплект RUS»).
// Компонент ссылается на assortment (товар/модификация) — берём его UUID (= external_id
// товара в CRM) и количество.
export async function fetchMoyskladBundles(token, { folderName } = {}) {
  const headers = authHeader(token);
  const rows = await fetchAll('/entity/bundle?expand=productFolder', token, 100);
  let bundles = rows;
  if (folderName) {
    const fn = folderName.toLowerCase();
    bundles = rows.filter((b) =>
      (b.productFolder?.name || '').toLowerCase().includes(fn) ||
      (b.pathName || '').toLowerCase().includes(fn));
  }
  const out = [];
  for (const b of bundles) {
    let components = [];
    try {
      const res = await msFetch(`${BASE}/entity/bundle/${b.id}/components?limit=1000`, headers);
      if (res.ok) { const d = await res.json(); components = d.rows || []; }
    } catch {
      // состав не критичен — сет заведём без него, менеджер дозаполнит
    }
    out.push({
      externalId: b.id,
      name: b.name || null,
      article: b.article || b.code || null,
      folder: b.productFolder?.name || b.pathName || null,
      components: components.map((c) => ({
        assortmentId: extractUuid(c.assortment?.meta?.href),
        assortmentType: c.assortment?.meta?.type || null,
        quantity: Number(c.quantity) || 1,
      })).filter((c) => c.assortmentId),
    });
  }
  return out;
}

// Найти meta папки товаров по имени (для размещения нового комплекта).
export async function findMoyskladFolderMeta(token, name) {
  if (!name) return null;
  const rows = await fetchAll('/entity/productfolder', token, 100);
  const fn = name.toLowerCase();
  const f = rows.find((r) => (r.name || '').toLowerCase() === fn)
    || rows.find((r) => (r.name || '').toLowerCase().includes(fn));
  return f?.meta ? { meta: f.meta } : null;
}

// Тип ассортимента (product|variant) по UUID — нужен для meta-ссылки компонента.
async function resolveAssortmentType(token, id) {
  const headers = authHeader(token);
  for (const type of ['product', 'variant']) {
    const res = await msFetch(`${BASE}/entity/${type}/${id}`, headers);
    try { await res.text(); } catch { /* тело не важно */ }
    if (res.ok) return type;
  }
  return null;
}

// Создать (POST) или обновить (PUT) комплект в МойСклад. Пишет в БОЕВОЙ МС.
// components: [{ externalId, quantity, type? }]. Возвращает { id, article, name }.
export async function pushMoyskladBundle(token, { msBundleId, name, article, components, folderName }) {
  const headers = { ...authHeader(token), 'Content-Type': 'application/json' };
  if (!components || !components.length) throw new Error('У комплекта нет состава — нечего отправлять в МойСклад');
  const comp = [];
  for (const c of components) {
    let type = c.type === 'product' || c.type === 'variant' ? c.type : await resolveAssortmentType(token, c.externalId);
    if (!type) throw new Error(`Компонент ${c.externalId} не найден в МойСклад (ни товар, ни модификация)`);
    comp.push({
      quantity: Number(c.quantity) || 1,
      assortment: { meta: { href: `${BASE}/entity/${type}/${c.externalId}`, type, mediaType: 'application/json' } },
    });
  }
  const body = { name: name || 'Комплект', overhead: { value: 0, distribution: 'weight' }, components: comp };
  if (article) body.article = article;
  if (!msBundleId && folderName) {
    const folder = await findMoyskladFolderMeta(token, folderName);
    if (folder) body.productFolder = folder;
  }
  const url = msBundleId ? `${BASE}/entity/bundle/${msBundleId}` : `${BASE}/entity/bundle`;
  const res = await fetch(url, {
    method: msBundleId ? 'PUT' : 'POST',
    headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`МойСклад ${res.status}: ${text.slice(0, 800)}`);
  const data = text ? JSON.parse(text) : {};
  return { id: data.id || null, article: data.article || null, name: data.name || null };
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

// Свежие остатки по складам для списка UUID. Раньше делали один батч
// `filter=product=URL1;product=URL2;…`, но multi-UUID запросы к МС
// стабильно валятся «fetch failed» на сетевом уровне (Node fetch +
// промежуточный Cloudflare похоже ломаются на `;` в filter; инцидент
// 2026-06-11 v3). Single-UUID запросы работают надёжно.
//
// Поэтому: делаем по одному запросу на UUID, параллельно по 5 (лимит МС
// «5 одновременных на токен»). Сначала пробуем как product; UUID,
// которые не вернулись, пробуем как variant. Для батча 50 это ~10 раундов
// × ~500мс = ~5с, в пределах Vercel 60s. Никаких 412-бисекций.
// Концепт «5 одновременных на токен» по докам МС, но на практике частые
// fetch-failed даже при низкой concurrency — оставляем 1 (последовательно)
// для максимальной надёжности. Производительность всё равно ок: каждый
// per-UUID запрос быстрый (~200-500мс).
const CONCURRENCY = 1;

async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function msFetchStockByProductIds(token, externalIds) {
  if (!externalIds?.length) return new Map();
  const headers = authHeader(token);
  const byId = new Map();

  async function fetchOne(entity, id) {
    const filter = `${entity}=${encodeURIComponent(`${BASE}/entity/${entity}/${id}`)}`;
    const url = `${BASE}/report/stock/bystore?filter=${filter}&limit=10`;
    const res = await msFetch(url, headers);
    if (!res.ok) {
      // 412 — UUID не сущность этого типа (например variant в product-батче,
      // или удалён). Молча скипаем — попробуем как variant потом.
      if (res.status !== 412) {
        const text = await res.text().catch(() => '');
        // eslint-disable-next-line no-console
        console.warn(`[ms-stock] ${entity}/${id} ${res.status}: ${text.slice(0, 200)}`);
      }
      return false;
    }
    const data = await res.json();
    for (const r of (data.rows || [])) {
      const stores = (r.stockByStore || []).map((s) => ({
        store: s.name || '—',
        stock: Number(s.stock) || 0,
        reserve: Number(s.reserve) || 0,
      }));
      const rid = extractUuid(r.meta?.href);
      if (rid) byId.set(rid, stores);
    }
    return true;
  }

  await pMapLimit(externalIds, CONCURRENCY, (id) => fetchOne('product', id));
  const missing = externalIds.filter((id) => !byId.has(id));
  if (missing.length) {
    await pMapLimit(missing, CONCURRENCY, (id) => fetchOne('variant', id));
  }
  return byId;
}

export async function fetchMoyskladStockByStorePage(token, offset = 0, limit = 500) {
  const headers = authHeader(token);
  const url = `${BASE}/report/stock/bystore?limit=${limit}&offset=${offset}`;
  const t0 = Date.now();
  const res = await msFetch(url, headers);
  const tFetch = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text();
    throw msError(res.status, text);
  }
  const data = await res.json();
  const tParse = Date.now() - t0 - tFetch;
  const rows = data.rows || [];
  // eslint-disable-next-line no-console
  console.log(`[moysklad] bystore offset=${offset} limit=${limit} rows=${rows.length} fetch=${tFetch}ms parse=${tParse}ms`);
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
  // Раньше тут собирались samples + дамп первой строки в pretty-JSON для
  // отладки (после рефакторинга осталась). Убрали: JSON.stringify крупной
  // строки + большой console.log замедляли cron и съедали бюджет 60с.
  const samples = [];

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
