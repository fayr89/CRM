// Свежая синхронизация остатков из МС: вместо общего отчёта (кешируется в МС
// до нескольких часов) тянем по конкретным UUID товаров — этот запрос МС не
// кеширует и отдаёт актуальное состояние.
//
// Подключается из app.js как middleware ДО /api/products: перехватывает
// POST /api/products/import/moysklad-stores и возвращает совместимый
// JSON-ответ. Фронт менять не нужно.
import { db } from '../db.js';
import { msFetchStockByProductIds } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

// PAGE = 50 товаров за один запрос в МС — длина URL filter=product=...
// около 8 КБ, в пределах безопасного лимита HTTP.
const PAGE = 50;

async function resolveToken(bodyToken) {
  if (bodyToken) return bodyToken;
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

export async function importMoyskladStoresFresh(req, res) {
  // Авторизация: только admin/aus (как было в основном хендлере).
  const role = req.user?.role;
  if (!['admin', 'aus'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const token = await resolveToken(req.body?.token);
  if (!token) return res.status(400).json({ error: 'Передайте токен МойСклад в теле {token: "..."}' });

  const offset = Math.max(0, parseInt(req.body?.offset, 10) || 0);

  const totalRow = await db.get(
    `SELECT COUNT(*)::int AS total FROM products
     WHERE external_source = 'moysklad' AND external_id IS NOT NULL
       AND is_markdown IS NOT TRUE AND active = TRUE`,
  );
  const total = totalRow?.total || 0;

  const products = await db.all(
    `SELECT id, external_id, sku FROM products
     WHERE external_source = 'moysklad' AND external_id IS NOT NULL
       AND is_markdown IS NOT TRUE AND active = TRUE
     ORDER BY id LIMIT ? OFFSET ?`,
    PAGE, offset,
  );
  if (!products.length) {
    return res.json({
      ok: true, updated: 0, cleared: 0, fetched: 0,
      nextOffset: offset, total, done: true, source: 'fresh',
    });
  }
  const ids = products.map((p) => p.external_id);
  let byId;
  try {
    byId = await msFetchStockByProductIds(token, ids);
  } catch (e) {
    return res.status(400).json({ error: 'МС: ' + e.message });
  }

  // present — товары, для которых МС вернул stockByStore (есть остатки).
  // absent — товары, которых МС не вернул в этом батче. РАНЬШЕ обнуляли их
  // в NULL — но если МС-батч валится 412 целиком, ВСЕ товары попадают в
  // absent и стираются (инцидент 2026-06-11 v2). Сейчас оставляем как было,
  // очисткой архивных занимается только полный cron stock-sync.
  const present = [];
  const presentJson = [];
  let absentCount = 0;
  for (const p of products) {
    const sbs = byId.get(p.external_id);
    if (sbs && sbs.length) {
      present.push(p.external_id);
      presentJson.push(JSON.stringify(sbs));
    } else {
      absentCount += 1;
    }
  }

  let updated = 0;
  await db.withTransaction(async (tx) => {
    if (present.length) {
      const r = await tx.run(
        `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
         FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
         WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
        present, presentJson,
      );
      updated = r.changes || 0;
    }
  });
  const cleared = 0;
  const keptAbsent = absentCount;

  const nextOffset = offset + products.length;
  const done = products.length < PAGE || nextOffset >= total;
  res.json({
    ok: true, updated, cleared, kept_absent: keptAbsent,
    fetched: products.length,
    nextOffset, total, done, source: 'fresh',
  });
}
