// Клиент МойСклад API (https://dev.moysklad.ru/doc/api/remap/1.2/).
// Используется для импорта товаров. Авторизация — Bearer-токен в MOYSKLAD_TOKEN.

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const PAGE_SIZE = 1000;

function authHeader(token) {
  if (!token) throw new Error('MOYSKLAD_TOKEN не задан');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8' };
}

// Постранично выкачивает все строки с эндпоинта МойСклад (limit=1000, offset инкрементируется).
async function fetchAll(endpoint, token) {
  const headers = authHeader(token);
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE}${endpoint}${sep}limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`МойСклад ответил ${res.status}: ${text.slice(0, 200)}`);
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
  const map = new Map();
  for (const r of rows) {
    const id = extractUuid(r.meta?.href);
    if (id) map.set(id, Number(r.stock) || 0);
  }
  return map;
}
