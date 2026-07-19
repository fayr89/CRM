// Клиенты API маркетплейсов для подтяжки номенклатуры канала (Phase 3).
// Пока — WB (первый канал). Возвращают плоский список позиций канала для
// matching с внутренней номенклатурой: { channel_barcode, channel_sku,
// channel_name, channel_extra }.
//
// Работает только при наличии реального API-ключа (заводится в справочнике
// «Каналы»). Без ключа/при ошибке — бросаем понятную ошибку, ничего не ломаем.

// WB Content API: список карточек товара (номенклатура продавца).
// Авторизация — ключ напрямую в заголовке Authorization (без Bearer).
export async function fetchWbCards(apiKey, { limit = 100 } = {}) {
  if (!apiKey) throw new Error('Не задан API-ключ WB');
  const url = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
  const body = {
    settings: {
      cursor: { limit: Math.min(1000, Math.max(1, limit)) },
      filter: { withPhoto: -1 },
    },
  };
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
  const out = [];
  for (const c of cards) {
    const vendorCode = c.vendorCode || c.vendorCode || null;
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
  return out;
}
