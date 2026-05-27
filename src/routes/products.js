import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { fetchMoyskladProducts, fetchMoyskladStock, fetchMoyskladStockByStorePage } from '../services/moysklad.js';
import { toCsv } from '../services/csv.js';
import { encryptSecret, decryptSecret } from '../services/secrets.js';

const router = Router();

// Возвращает токен МойСклад: из тела запроса, иначе сохранённый в БД (шифрованный), иначе env.
async function resolveMoyskladToken(bodyToken) {
  if (bodyToken) return bodyToken;
  const row = await db
    .get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`)
    .catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

const SORT_COLUMNS = ['id', 'name', 'sku', 'cost_price', 'stock', 'created_at', 'updated_at'];

router.use(authenticate);

const productSchema = z.object({
  sku: z.string().optional().nullable(),
  name: z.string().min(1),
  image_url: z.string().optional().nullable(),
  cost_price: z.number().nonnegative().optional().default(0),
  unit: z.string().optional().default('шт'),
  description: z.string().optional().nullable(),
  active: z.boolean().optional().default(true),
});

const updateSchema = productSchema.partial();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'name', 'ASC');
    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(p.name ILIKE ? OR p.sku ILIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s);
    }
    if (req.query.active === 'true') where.push('p.active = TRUE');
    if (req.query.active === 'false') where.push('p.active = FALSE');
    if (req.query.stock === 'in') where.push('p.stock > 0');
    if (req.query.stock === 'out') where.push('(p.stock IS NULL OR p.stock <= 0)');
    if (req.query.supplier) {
      where.push('p.supplier = ?');
      params.push(String(req.query.supplier));
    }
    // Фильтр по складу: товары с положительным остатком на указанном складе.
    if (req.query.warehouse) {
      where.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(p.stock_by_store) e
                 WHERE e->>'store' = ? AND (e->>'stock')::numeric > 0)`,
      );
      params.push(String(req.query.warehouse));
    }
    // Фильтр по наличию прайса.
    if (req.query.priced === 'with') {
      where.push('EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)');
    } else if (req.query.priced === 'without') {
      where.push('NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = p.id)');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM product_prices pp WHERE pp.product_id = p.id) AS price_count,
              (SELECT json_agg(json_build_object('marketplace', pp.marketplace, 'price', pp.price) ORDER BY pp.marketplace)
               FROM product_prices pp WHERE pp.product_id = p.id) AS prices
       FROM products p
       ${whereSql} ORDER BY p.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM products p ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

// Вернуть товары с ценой для конкретной площадки — для пикера в форме заказа.
router.get(
  '/for-marketplace',
  asyncHandler(async (req, res) => {
    const marketplace = String(req.query.marketplace || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    const search = String(req.query.search || '').trim();
    const where = ['p.active = TRUE'];
    const params = [];
    if (search) {
      where.push('(p.name ILIKE ? OR p.sku ILIKE ?)');
      const s = `%${search}%`;
      params.push(s, s);
    }
    const rows = await db.all(
      `SELECT p.id, p.sku, p.name, p.image_url, p.cost_price, p.unit, p.stock, p.stock_by_store,
              pp.price AS marketplace_price
       FROM products p
       LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = ? AND pp.warehouse = ?
       WHERE ${where.join(' AND ')}
       ORDER BY p.name ASC LIMIT 50`,
      marketplace,
      warehouse,
      ...params,
    );
    res.json({ data: rows, marketplace, warehouse });
  }),
);

// Топ-20 популярных товаров за последние 30 дней — для блока быстрого добавления.
// Если в указанной площадке нет цены, marketplace_price = null (менеджер увидит «нет в прайсе»).
router.get(
  '/popular',
  asyncHandler(async (req, res) => {
    const marketplace = String(req.query.marketplace || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const rows = await db.all(
      `SELECT p.id, p.sku, p.name, p.image_url, p.cost_price, p.unit, p.stock, p.stock_by_store,
              pp.price AS marketplace_price,
              COALESCE((
                SELECT SUM(oi.quantity)::int
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id
                  AND o.created_at > NOW() - (? || ' days')::interval
                  AND o.status != 'cancelled'
              ), 0) AS recent_usage
       FROM products p
       LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = ? AND pp.warehouse = ?
       WHERE p.active = TRUE
       ORDER BY recent_usage DESC, p.name ASC
       LIMIT ?`,
      String(days),
      marketplace,
      warehouse,
      limit,
    );
    res.json({ data: rows, marketplace, days });
  }),
);

// Шаблон прайса (CSV для Excel). Колонки: Артикул мойсклад, Себестоимость, Название,
// Канал продаж, Цена для канала продаж. Если задан ?marketplace=… — колонка канала
// предзаполняется, а в цену подставляется текущая цена этого канала (если есть).
router.get(
  '/price-template.csv',
  asyncHandler(async (req, res) => {
    const marketplace = String(req.query.marketplace || '').trim();
    const warehouse = String(req.query.warehouse || '').trim();
    // Цену для строки подставляем, если заданы и канал, и склад (ключ прайса).
    const joinPrice = marketplace && warehouse;
    const rows = await db.all(
      `SELECT p.sku, p.name, p.cost_price, p.supplier,
              ${joinPrice ? 'pp.price AS channel_price' : 'NULL::real AS channel_price'}
       FROM products p
       ${joinPrice ? 'LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = ? AND pp.warehouse = ?' : ''}
       WHERE p.active = TRUE
       ORDER BY p.name ASC`,
      ...(joinPrice ? [marketplace, warehouse] : []),
    );
    const columns = [
      { key: 'sku', label: 'Артикул мойсклад', text: true },
      { key: 'supplier', label: 'Поставщик' },
      { key: 'cost_price', label: 'Себестоимость' },
      { key: 'name', label: 'Название' },
      { key: 'channel', label: 'Канал продаж', get: () => marketplace },
      { key: 'warehouse', label: 'Склад', get: () => warehouse },
      { key: 'channel_price', label: 'Цена для канала продаж', format: (v) => (v == null ? '' : v) },
    ];
    const csv = toCsv(rows, columns);
    // В имени файла только ASCII — Node не пропускает кириллицу в заголовке.
    const safe = `${marketplace || 'all'}-${warehouse || 'all'}`.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="price-template-${safe}.csv"`);
    res.send(csv);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await db.get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!product) throw NotFound('Товар не найден');
    const prices = await db.all(
      'SELECT marketplace, warehouse, price FROM product_prices WHERE product_id = ? ORDER BY marketplace, warehouse',
      product.id,
    );
    res.json({ ...product, prices });
  }),
);

router.post(
  '/',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const r = await db.run(
      `INSERT INTO products (sku, name, image_url, cost_price, unit, description, active)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.sku ?? null,
      data.name,
      data.image_url ?? null,
      data.cost_price ?? 0,
      data.unit ?? 'шт',
      data.description ?? null,
      data.active ?? true,
    );
    res.status(201).json(await db.get('SELECT * FROM products WHERE id = ?', r.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const updates = [];
    const params = [];
    for (const k of ['sku', 'name', 'image_url', 'cost_price', 'unit', 'description', 'active']) {
      if (data[k] !== undefined) {
        updates.push(`${k} = ?`);
        params.push(data[k] === '' ? null : data[k]);
      }
    }
    if (!updates.length) {
      return res.json(await db.get('SELECT * FROM products WHERE id = ?', req.params.id));
    }
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await db.run(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`, ...params);
    if (r.changes === 0) throw NotFound('Товар не найден');
    res.json(await db.get('SELECT * FROM products WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await db.run('DELETE FROM products WHERE id = ?', req.params.id);
    if (r.changes === 0) throw NotFound('Товар не найден');
    res.status(204).send();
  }),
);

// --- Прайсы товара (товар × площадка) ---

const priceSchema = z.object({
  marketplace: z.string().min(1),
  warehouse: z.string().min(1, 'Укажите склад'),
  price: z.number().nonnegative(),
});

router.put(
  '/:id/prices',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const data = priceSchema.parse(req.body);
    const product = await db.get('SELECT id FROM products WHERE id = ?', req.params.id);
    if (!product) throw NotFound('Товар не найден');
    await db.run(
      `INSERT INTO product_prices (product_id, marketplace, warehouse, price)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (product_id, marketplace, warehouse)
       DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()`,
      product.id,
      data.marketplace,
      data.warehouse ?? '',
      data.price,
    );
    res.json(
      await db.get(
        'SELECT * FROM product_prices WHERE product_id = ? AND marketplace = ? AND warehouse = ?',
        product.id,
        data.marketplace,
        data.warehouse ?? '',
      ),
    );
  }),
);

router.delete(
  '/:id/prices/:marketplace',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    await db.run(
      'DELETE FROM product_prices WHERE product_id = ? AND marketplace = ? AND warehouse = ?',
      req.params.id,
      req.params.marketplace,
      String(req.query.warehouse || ''),
    );
    res.status(204).send();
  }),
);

// --- Импорт из МойСклад ---

router.post(
  '/import/moysklad',
  requireRole('admin', 'aus'),
  asyncHandler(async (req, res) => {
    const token = await resolveMoyskladToken(req.body?.token);
    if (!token) {
      throw BadRequest(
        'Передайте токен МойСклад в теле запроса {token: "..."} или установите переменную окружения MOYSKLAD_TOKEN',
      );
    }
    let products;
    try {
      products = await fetchMoyskladProducts(token);
    } catch (e) {
      throw BadRequest(e.message);
    }
    // Предзагружаем уже импортированные товары одним запросом, чтобы не делать
    // отдельный SELECT на каждую позицию (иначе большой каталог упирается в таймаут).
    const existingRows = await db.all(
      `SELECT id, external_id FROM products WHERE external_source = 'moysklad'`,
    );
    const idByExternal = new Map(existingRows.map((r) => [r.external_id, r.id]));

    let created = 0;
    let updated = 0;
    const skipped = [];

    const COLS =
      '(sku, name, image_url, cost_price, unit, description, supplier, external_source, external_id, active)';
    const UPSERT_TAIL = `ON CONFLICT (external_source, external_id) DO UPDATE SET
        sku = COALESCE(EXCLUDED.sku, products.sku),
        name = EXCLUDED.name,
        image_url = COALESCE(EXCLUDED.image_url, products.image_url),
        cost_price = EXCLUDED.cost_price,
        unit = EXCLUDED.unit,
        description = EXCLUDED.description,
        supplier = COALESCE(EXCLUDED.supplier, products.supplier),
        updated_at = NOW()`;

    const upsertChunk = (chunk) => {
      const rows = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, 'moysklad', ?, TRUE)").join(', ');
      const params = [];
      for (const p of chunk) {
        params.push(p.sku, p.name, p.imageUrl, p.costPrice, p.unit, p.description, p.supplier ?? null, p.externalId);
      }
      return db.run(`INSERT INTO products ${COLS} VALUES ${rows} ${UPSERT_TAIL}`, ...params);
    };

    const countChunk = (chunk) => {
      for (const p of chunk) {
        if (idByExternal.has(p.externalId)) updated += 1;
        else created += 1;
      }
    };

    // Пишем пачками (сотни строк одним запросом) — тысячи отдельных запросов
    // не укладываются в лимит времени функции (60с на Hobby).
    const CHUNK = 400;
    for (let i = 0; i < products.length; i += CHUNK) {
      const chunk = products.slice(i, i + CHUNK);
      try {
        await upsertChunk(chunk);
        countChunk(chunk);
      } catch {
        // Пачка упала (например, дубликат SKU) — повторяем построчно, чтобы
        // изолировать проблемные позиции и не потерять остальные.
        for (const p of chunk) {
          try {
            await upsertChunk([p]);
            countChunk([p]);
          } catch (err) {
            skipped.push({ name: p.name, sku: p.sku, error: err.message });
          }
        }
      }
    }
    const withSupplier = products.filter((p) => p.supplier).length;
    const supplierSample = products.find((p) => p.supplier)?.supplier || null;
    res.json({
      ok: true, created, updated, skipped: skipped.length, skipped_details: skipped,
      total: products.length, withSupplier, supplierSample,
    });
  }),
);

// Быстрое обновление только остатков (без выгрузки самого каталога).
router.post(
  '/import/moysklad-stock',
  requireRole('admin', 'aus'),
  asyncHandler(async (req, res) => {
    const token = await resolveMoyskladToken(req.body?.token);
    if (!token) {
      throw BadRequest('Передайте токен МойСклад в теле запроса {token: "..."}');
    }
    let report;
    try {
      report = await fetchMoyskladStock(token);
    } catch (e) {
      throw BadRequest(e.message);
    }
    const { byId, bySku, count } = report;

    if (count === 0) {
      res.json({ ok: true, updated: 0, total: 0 });
      return;
    }

    let updated = 0;
    try {
      await db.withTransaction(async (tx) => {
        // На пулере соединение могло «застрять» на старой схеме без колонки stock —
        // в той же транзакции гарантируем её, затем обновляем остатки.
        await tx.run('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock REAL');
        if (byId.size) {
          const r = await tx.run(
            `UPDATE products AS p SET stock = d.stock, updated_at = NOW()
             FROM unnest(?::text[], ?::real[]) AS d(external_id, stock)
             WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
            [...byId.keys()],
            [...byId.values()],
          );
          updated += r.changes || 0;
        }
        if (bySku.size) {
          // Запасной путь: по артикулу — для тех, кого не нашли по UUID.
          const r = await tx.run(
            `UPDATE products AS p SET stock = d.stock, updated_at = NOW()
             FROM unnest(?::text[], ?::real[]) AS d(sku, stock)
             WHERE p.external_source = 'moysklad' AND p.sku = d.sku AND p.stock IS NULL`,
            [...bySku.keys()],
            [...bySku.values()],
          );
          updated += r.changes || 0;
        }
      });
    } catch (e) {
      throw BadRequest('Не удалось записать остатки: ' + e.message);
    }
    res.json({ ok: true, updated, total: count });
  }),
);

// Остатки по складам — порционно: фронт вызывает с растущим offset, пока done=false.
// По 500 позиций за запрос, чтобы тяжёлый отчёт укладывался в лимит времени.
router.post(
  '/import/moysklad-stores',
  requireRole('admin', 'aus'),
  asyncHandler(async (req, res) => {
    const token = await resolveMoyskladToken(req.body?.token);
    if (!token) {
      throw BadRequest('Передайте токен МойСклад в теле запроса {token: "..."}');
    }
    const offset = Math.max(0, parseInt(req.body?.offset, 10) || 0);
    const LIMIT = 1000;
    let page;
    try {
      page = await fetchMoyskladStockByStorePage(token, offset, LIMIT);
    } catch (e) {
      throw BadRequest(e.message);
    }
    const { byId, bySku, size, fetched, samples, rowCount } = page;
    let updatedById = 0;
    let updatedBySku = 0;
    let matchedIds = [];
    let matchedSkus = [];

    if (byId.size || bySku.size) {
      try {
        await db.withTransaction(async (tx) => {
          await tx.run('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_by_store JSONB');
          // Основное сопоставление — по external_id (UUID из отчёта), как в остатках.
          if (byId.size) {
            const ids = [...byId.keys()];
            const jsons = ids.map((k) => JSON.stringify(byId.get(k)));
            // Проверяем, какие external_id есть в БД
            const existing = await tx.all(
              `SELECT external_id FROM products WHERE external_source = 'moysklad' AND external_id = ANY(?)`,
              ids,
            );
            matchedIds = existing.map((r) => r.external_id);
            const r = await tx.run(
              `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
               FROM unnest(?::text[], ?::jsonb[]) AS d(external_id, sbs)
               WHERE p.external_source = 'moysklad' AND p.external_id = d.external_id`,
              ids,
              jsons,
            );
            updatedById = r.changes || 0;
          }
          // Резерв — по артикулу, только для строк, куда ещё не записали по id.
          if (bySku.size) {
            const skus = [...bySku.keys()];
            const jsons = skus.map((s) => JSON.stringify(bySku.get(s)));
            // Проверяем, какие sku есть в БД
            const existing = await tx.all(
              `SELECT sku FROM products WHERE external_source = 'moysklad' AND sku = ANY(?)`,
              skus,
            );
            matchedSkus = existing.map((r) => r.sku);
            const r = await tx.run(
              `UPDATE products AS p SET stock_by_store = d.sbs, updated_at = NOW()
               FROM unnest(?::text[], ?::jsonb[]) AS d(sku, sbs)
               WHERE p.external_source = 'moysklad' AND p.sku = d.sku AND p.stock_by_store IS NULL`,
              skus,
              jsons,
            );
            updatedBySku = r.changes || 0;
          }
        });
      } catch (e) {
        throw BadRequest('Не удалось записать склады: ' + e.message);
      }
    }
    const updated = updatedById + updatedBySku;
    const nextOffset = offset + fetched;
    const done = fetched < LIMIT || nextOffset >= size;
    console.log(
      `[stores] offset=${offset} fetched=${fetched} byId=${byId.size} (matched ${matchedIds.length}) ` +
        `bySku=${bySku.size} (matched ${matchedSkus.length}) updatedById=${updatedById} updatedBySku=${updatedBySku}`,
    );
    res.json({
      ok: true,
      updated,
      updatedById,
      updatedBySku,
      fetched,
      nextOffset,
      total: size,
      done,
      samples: offset === 0 ? samples : undefined,
      debug: offset === 0 ? {
        rowCount,
        byIdCount: byId.size,
        bySkuCount: bySku.size,
        matchedIds: matchedIds.slice(0, 5),
        matchedSkus: matchedSkus.slice(0, 5),
      } : undefined,
    });
  }),
);

// Загрузка прайса из CSV-шаблона. Фронт парсит файл и присылает строки
// [{ sku, marketplace, price }] (только заполненные). Сопоставляем по артикулу.
const priceRowSchema = z.object({
  sku: z.string().min(1),
  marketplace: z.string().min(1),
  warehouse: z.string().default(''),
  price: z.number().nonnegative(),
});

router.post(
  '/import/prices',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const parsed = z.array(priceRowSchema).max(50000).parse(req.body?.rows || []);
    // Строгая модель: цена без склада недопустима — отбрасываем такие строки.
    const input = parsed.filter((r) => r.warehouse && String(r.warehouse).trim());
    const skippedNoWarehouse = parsed.length - input.length;
    if (!input.length) {
      res.json({ ok: true, upserted: 0, notFound: 0, total: parsed.length, skippedNoWarehouse });
      return;
    }
    // Дедуп по (sku, marketplace, warehouse) — последняя строка побеждает. Иначе ON CONFLICT
    // упадёт на повторе одного и того же ключа в рамках одного INSERT.
    const seen = new Map();
    for (const r of input) seen.set(`${r.sku}\u0000${r.marketplace}\u0000${r.warehouse || ""}`, r);
    const rows = [...seen.values()];

    const skus = rows.map((r) => r.sku);
    const markets = rows.map((r) => r.marketplace);
    const warehouses = rows.map((r) => r.warehouse || '');
    const prices = rows.map((r) => r.price);

    let upserted = 0;
    try {
      await db.withTransaction(async (tx) => {
        const r = await tx.run(
          `INSERT INTO product_prices (product_id, marketplace, warehouse, price)
           SELECT p.id, d.marketplace, d.warehouse, d.price
           FROM unnest(?::text[], ?::text[], ?::text[], ?::real[]) AS d(sku, marketplace, warehouse, price)
           JOIN products p ON p.sku = d.sku
           ON CONFLICT (product_id, marketplace, warehouse)
           DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()`,
          skus,
          markets,
          warehouses,
          prices,
        );
        upserted = r.changes || 0;
      });
    } catch (e) {
      throw BadRequest('Не удалось загрузить прайс: ' + e.message);
    }
    res.json({ ok: true, upserted, notFound: rows.length - upserted, total: parsed.length, skippedNoWarehouse });
  }),
);

// Удалить «легаси»-прайсы без склада (строгая модель канал+склад). Только админ.
router.post(
  '/prices/purge-legacy',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const r = await db.run("DELETE FROM product_prices WHERE warehouse IS NULL OR warehouse = ''");
    res.json({ ok: true, deleted: r.changes || 0 });
  }),
);

// --- Настройка видимости складов ---
// Список всех складов (из stock_by_store) + какие скрыты (app_settings).
router.get(
  '/warehouses/list',
  asyncHandler(async (_req, res) => {
    let all = [];
    try {
      const rows = await db.all(
        `SELECT DISTINCT el->>'store' AS store
         FROM products p, jsonb_array_elements(p.stock_by_store) AS el
         WHERE p.stock_by_store IS NOT NULL AND jsonb_typeof(p.stock_by_store) = 'array'
         ORDER BY store`,
      );
      all = rows.map((r) => r.store).filter(Boolean);
    } catch (e) {
      console.error('[warehouses/list] error:', e.message);
    }
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'warehouses.hidden'`)
      .catch(() => null);
    const hidden = setting?.value || [];
    const defSetting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'warehouses.default_writeoff'`)
      .catch(() => null);
    const default_writeoff = defSetting?.value || '';
    res.json({ all, hidden, default_writeoff });
  }),
);

// Склад списания по умолчанию (подставляется в форму заказа). Меняет только админ.
router.put(
  '/warehouses/default',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const warehouse = z.object({ warehouse: z.string() }).parse(req.body || {}).warehouse;
    await db.run(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('warehouses.default_writeoff', ?::jsonb, ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      JSON.stringify(warehouse || ''),
      req.user.id,
    );
    res.json({ ok: true, default_writeoff: warehouse || '' });
  }),
);

// Уникальные поставщики (для фильтра в каталоге).
router.get(
  '/suppliers/list',
  asyncHandler(async (_req, res) => {
    let suppliers = [];
    try {
      const rows = await db.all(
        `SELECT DISTINCT supplier FROM products WHERE supplier IS NOT NULL AND supplier <> '' ORDER BY supplier`,
      );
      suppliers = rows.map((r) => r.supplier);
    } catch {
      // колонки supplier ещё нет — вернём пустой список
    }
    res.json({ suppliers });
  }),
);

const DEFAULT_MARKETPLACES = ['Wildberries', 'Ozon', 'Яндекс.Маркет', 'Avito', 'Другое'];

// Список площадок (для форм заказа/прайсов). Хранится в app_settings, админ редактирует.
router.get(
  '/marketplaces/list',
  asyncHandler(async (_req, res) => {
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'marketplaces'`)
      .catch(() => null);
    const marketplaces = Array.isArray(setting?.value) && setting.value.length
      ? setting.value
      : DEFAULT_MARKETPLACES;
    res.json({ marketplaces });
  }),
);

const marketplacesSchema = z.object({
  marketplaces: z.array(z.string().min(1).max(100)).max(100),
});

router.put(
  '/marketplaces',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { marketplaces } = marketplacesSchema.parse(req.body);
    // Убираем дубли и пустые, сохраняем порядок
    const clean = [...new Set(marketplaces.map((m) => m.trim()).filter(Boolean))];
    await db.withTransaction(async (tx) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      await tx.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('marketplaces', ?::jsonb, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        JSON.stringify(clean),
        req.user.id,
      );
    });
    res.json({ marketplaces: clean });
  }),
);

const DEFAULT_DELIVERY_METHODS = ['Авито доставка', 'Почта', 'ЯМаркет', 'СДЭК', 'Dpd', '5post'];

// Способы доставки (для формы заказа). Хранятся в app_settings, админ редактирует.
router.get(
  '/delivery-methods/list',
  asyncHandler(async (_req, res) => {
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'delivery_methods'`)
      .catch(() => null);
    const delivery_methods = Array.isArray(setting?.value) && setting.value.length
      ? setting.value
      : DEFAULT_DELIVERY_METHODS;
    res.json({ delivery_methods });
  }),
);

const deliveryMethodsSchema = z.object({
  delivery_methods: z.array(z.string().min(1).max(100)).max(100),
});

router.put(
  '/delivery-methods',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { delivery_methods } = deliveryMethodsSchema.parse(req.body);
    const clean = [...new Set(delivery_methods.map((m) => m.trim()).filter(Boolean))];
    await db.withTransaction(async (tx) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      await tx.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('delivery_methods', ?::jsonb, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        JSON.stringify(clean),
        req.user.id,
      );
    });
    res.json({ delivery_methods: clean });
  }),
);

const DEFAULT_CANCEL_REASONS = ['Клиент отказался', 'Нет в наличии', 'Брак товара', 'Дубликат заказа', 'Ошибка оформления', 'Другое'];

// Причины отмены заказа (для формы отмены). Хранятся в app_settings, админ редактирует.
router.get(
  '/cancel-reasons/list',
  asyncHandler(async (_req, res) => {
    const setting = await db
      .get(`SELECT value FROM app_settings WHERE key = 'cancel_reasons'`)
      .catch(() => null);
    const cancel_reasons = Array.isArray(setting?.value) && setting.value.length
      ? setting.value
      : DEFAULT_CANCEL_REASONS;
    res.json({ cancel_reasons });
  }),
);

const cancelReasonsSchema = z.object({
  cancel_reasons: z.array(z.string().min(1).max(200)).max(100),
});

router.put(
  '/cancel-reasons',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { cancel_reasons } = cancelReasonsSchema.parse(req.body);
    const clean = [...new Set(cancel_reasons.map((m) => m.trim()).filter(Boolean))];
    await db.withTransaction(async (tx) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      await tx.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('cancel_reasons', ?::jsonb, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        JSON.stringify(clean),
        req.user.id,
      );
    });
    res.json({ cancel_reasons: clean });
  }),
);

// Токен МойСклад: сохранение (шифрованно) и статус. Меняют админ/АУС.
router.get(
  '/moysklad-token/status',
  asyncHandler(async (_req, res) => {
    const row = await db
      .get(`SELECT value, updated_at FROM app_settings WHERE key = 'moysklad.token'`)
      .catch(() => null);
    const hasStored = !!(row?.value && decryptSecret(row.value));
    res.json({ hasToken: hasStored || !!process.env.MOYSKLAD_TOKEN, fromEnv: !hasStored && !!process.env.MOYSKLAD_TOKEN, updated_at: row?.updated_at || null });
  }),
);

const tokenSchema = z.object({ token: z.string().min(8).max(4000) });

router.put(
  '/moysklad-token',
  requireRole('admin', 'aus'),
  asyncHandler(async (req, res) => {
    const { token } = tokenSchema.parse(req.body);
    const encrypted = encryptSecret(token.trim());
    await db.withTransaction(async (tx) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      await tx.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('moysklad.token', ?::jsonb, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        JSON.stringify(encrypted),
        req.user.id,
      );
    });
    res.json({ ok: true, hasToken: true });
  }),
);

const hiddenSchema = z.object({
  hidden: z.array(z.string()).max(500),
});

router.put(
  '/warehouses/hidden',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { hidden } = hiddenSchema.parse(req.body);
    await db.withTransaction(async (tx) => {
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      await tx.run(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ('warehouses.hidden', ?::jsonb, ?, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        JSON.stringify(hidden),
        req.user.id,
      );
    });
    res.json({ ok: true, hidden });
  }),
);

export default router;
