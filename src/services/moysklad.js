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

// Запрос к МойСклад с повтором при 429/503. При превышении лимита одновременных
// запросов МойСклад отдаёт 429 (код 1073) — ждём с растущей паузой и повторяем
// (ресурсоёмкие отчёты остатков часто пересекаются с другими запросами по токену).
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
  return new Error(`МойСклад ответил ${status}: ${text.slice(0, 200)}`);
}

// Постранично выкачивает все строки с эндпоинта МойСклад (limit=1000, offset инкрементируется).
async function fetchAll(endpoint, token) {
  const headers = authHeader(token);
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE}${endpoint}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await msFetch(url, headers);
    if (!res.ok) {
      const text = await res.text();
      throw msError(res.status, text);
    }
    const data = await res.json();
    const rows = data.rows || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

function pickImage(images) {
  const first = images?.rows?.[0];
  return first?.miniature?.href || first?.tiny?.href || null;
}

function mapSalePrices(salePrices) {
  return (salePrices || []).map((sp) => ({
    name: sp.priceType?.name || 'Цена',
    value: (sp.value || 0) / 100,
  }));
}

function mapProduct(p) {
  return {
    externalId: p.id,
    sku: p.code || p.article || null,
    name: p.name,
    costPrice: (p.buyPrice?.value || 0) / 100,
    defaultPrice: p.salePrices?.[0]?.value ? p.salePrices[0].value / 100 : 0,
    salePrices: mapSalePrices(p.salePrices),
    imageUrl: pickImage(p.images),
    unit: p.uom?.name || 'шт',
    description: p.description || null,
  };
}

// .../entity/product/<UUID> → <UUID>
function extractUuid(href) {
  return href ? href.split('/').pop() : null;
}

// У модификаций часть полей наследуется от родителя (uom, описание, изображения, цены).
// В ответе МойСклад они не дублируются, поэтому подмёрживаем из уже загруженных products.
function mapVariant(v, productById) {
  const parentId = extractUuid(v.product?.meta?.href);
  const parent = parentId ? productById.get(parentId) : null;

  const ownSalePrices = mapSalePrices(v.salePrices);
  const ownImage = pickImage(v.images);
  const buy = (v.buyPrice?.value || 0) / 100;

  // У модификации код по умолчанию равен родительскому → ловим коллизию по unique sku.
  // Дописываем значения характеристик: "TSH-001/Красный/XL".
  const baseCode = v.code || v.article || parent?.sku || null;
  const charSuffix = (v.characteristics || []).map((c) => c.value).filter(Boolean).join('/');
  const sku = baseCode
    ? (charSuffix ? `${baseCode}/${charSuffix}` : `${baseCode}/${v.id.slice(0, 8)}`)
    : null;

  return {
    externalId: v.id,
    sku,
    name: v.name, // МойСклад уже формирует "Продукт / Цвет / Размер"
    costPrice: buy || parent?.costPrice || 0,
    defaultPrice: ownSalePrices[0]?.value ?? parent?.defaultPrice ?? 0,
    salePrices: ownSalePrices.length ? ownSalePrices : (parent?.salePrices || []),
    imageUrl: ownImage || parent?.imageUrl || null,
    unit: parent?.unit || 'шт',
    description: parent?.description || null,
  };
}

// Возвращает плоский массив товаров + модификаций из МойСклад.
// МойСклад хранит цены в копейках — делим на 100.
export async function fetchMoyskladProducts(token) {
  const productRows = await fetchAll('/entity/product?expand=images', token);
  const products = productRows.map(mapProduct);
  const productById = new Map(products.map((p) => [p.externalId, p]));

  const variantRows = await fetchAll('/entity/variant?expand=images', token);
  const variants = variantRows.map((v) => mapVariant(v, productById));

  return [...products, ...variants];
}

// Текущие остатки по всем складам: Map(externalId → количество).
// Берём из отчёта /report/stock/all, привязка по UUID из meta.href.
export async function fetchMoyskladStock(token) {
  const rows = await fetchAll('/report/stock/all', token);
  const byId = new Map();
  const bySku = new Map();
  for (const r of rows) {
    const stock = Number(r.stock) || 0;
    const id = extractUuid(r.meta?.href);
    if (id) byId.set(id, stock);
    const sku = r.code || r.article;
    if (sku) bySku.set(String(sku), stock);
  }
  return { byId, bySku, count: rows.length, sample: rows[0] || null };
}

// Одна страница отчёта по складам — для порционной загрузки большого каталога.
// Возвращает Map(sku → [{store, stock}]) для страницы + общий размер отчёта.
export async function fetchMoyskladStockByStorePage(token, offset = 0, limit = 500) {
  const headers = authHeader(token);
  const url = `${BASE}/report/stock/bystore/current?limit=${limit}&offset=${offset}`;
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
    // Сохраняем все склады, включая с нулевыми остатками — для полной информации
    const stores = (r.stockByStore || []).map((s) => ({
      store: s.name || '—',
      stock: Number(s.stock) || 0,
    }));
    const id = extractUuid(r.meta?.href);
    if (id && stores.length) byId.set(id, stores);
    const sku = r.code || r.article;
    if (sku && stores.length) bySku.set(String(sku), stores);
  }
  const samples = rows.slice(0, 3).map((r) => ({
    code: r.code ?? null,
    article: r.article ?? null,
    uuid: extractUuid(r.meta?.href),
    storeCount: (r.stockByStore || []).length,
    stores: (r.stockByStore || []).map((s) => ({
      name: s.name ?? null,
      stock: Number(s.stock) ?? null,
    })),
  }));

  // Полная структура первой строки для отладки
  const firstRowFull = rows[0] ? JSON.stringify(rows[0], null, 2) : null;
  console.log(
    `[moysklad] /report/stock/bystore: ${rows.length} rows, ` +
    `byId.size=${byId.size}, bySku.size=${bySku.size}, ` +
    `first row keys=${rows[0] ? Object.keys(rows[0]).join(', ') : 'N/A'}`,
  );
  if (firstRowFull) console.log('[moysklad] first row:', firstRowFull);

  return { byId, bySku, samples, size: data.meta?.size ?? offset + rows.length, fetched: rows.length, rowCount: rows.length };
}
