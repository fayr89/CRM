// Клиент МойСклад API (https://dev.moysklad.ru/doc/api/remap/1.2/).
// Используется для импорта товаров. Авторизация — Bearer-токен в MOYSKLAD_TOKEN.

const BASE = 'https://api.moysklad.ru/api/remap/1.2';

function authHeader(token) {
  if (!token) throw new Error('MOYSKLAD_TOKEN не задан');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json;charset=utf-8' };
}

// Возвращает плоский массив товаров из МойСклад: {externalId, sku, name, costPrice, imageUrl, defaultPrice}.
// МойСклад хранит цены в копейках — делим на 100.
// Картинка — первая из images, через отдельный download href, требует тот же токен.
export async function fetchMoyskladProducts(token, { limit = 1000 } = {}) {
  const headers = authHeader(token);
  const url = `${BASE}/entity/product?limit=${Math.min(limit, 1000)}&expand=images`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`МойСклад ответил ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const rows = data.rows || [];

  return rows.map((p) => {
    const buy = (p.buyPrice?.value || 0) / 100;
    const sale = p.salePrices?.[0]?.value ? p.salePrices[0].value / 100 : 0;
    const allSalePrices = (p.salePrices || []).map((sp) => ({
      name: sp.priceType?.name || 'Цена',
      value: (sp.value || 0) / 100,
    }));
    const firstImage = p.images?.rows?.[0];
    return {
      externalId: p.id,
      sku: p.code || p.article || null,
      name: p.name,
      costPrice: buy,
      defaultPrice: sale,
      salePrices: allSalePrices,
      imageUrl: firstImage?.miniature?.href || firstImage?.tiny?.href || null,
      unit: p.uom?.name || 'шт',
      description: p.description || null,
    };
  });
}
