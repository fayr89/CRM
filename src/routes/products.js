import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';
import { fetchMoyskladProducts, fetchMoyskladStock } from '../services/moysklad.js';

const router = Router();

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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM product_prices pp WHERE pp.product_id = p.id) AS price_count
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
    const search = String(req.query.search || '').trim();
    const where = ['p.active = TRUE'];
    const params = [];
    if (search) {
      where.push('(p.name ILIKE ? OR p.sku ILIKE ?)');
      const s = `%${search}%`;
      params.push(s, s);
    }
    const rows = await db.all(
      `SELECT p.id, p.sku, p.name, p.image_url, p.cost_price, p.unit,
              pp.price AS marketplace_price
       FROM products p
       LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = ?
       WHERE ${where.join(' AND ')}
       ORDER BY p.name ASC LIMIT 50`,
      marketplace,
      ...params,
    );
    res.json({ data: rows, marketplace });
  }),
);

// Топ-20 популярных товаров за последние 30 дней — для блока быстрого добавления.
// Если в указанной площадке нет цены, marketplace_price = null (менеджер увидит «нет в прайсе»).
router.get(
  '/popular',
  asyncHandler(async (req, res) => {
    const marketplace = String(req.query.marketplace || '').trim();
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const rows = await db.all(
      `SELECT p.id, p.sku, p.name, p.image_url, p.cost_price, p.unit,
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
       LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = ?
       WHERE p.active = TRUE
       ORDER BY recent_usage DESC, p.name ASC
       LIMIT ?`,
      String(days),
      marketplace,
      limit,
    );
    res.json({ data: rows, marketplace, days });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await db.get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!product) throw NotFound('Товар не найден');
    const prices = await db.all(
      'SELECT marketplace, price FROM product_prices WHERE product_id = ? ORDER BY marketplace',
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
      `INSERT INTO product_prices (product_id, marketplace, price)
       VALUES (?, ?, ?)
       ON CONFLICT (product_id, marketplace)
       DO UPDATE SET price = EXCLUDED.price, updated_at = NOW()`,
      product.id,
      data.marketplace,
      data.price,
    );
    res.json(
      await db.get(
        'SELECT * FROM product_prices WHERE product_id = ? AND marketplace = ?',
        product.id,
        data.marketplace,
      ),
    );
  }),
);

router.delete(
  '/:id/prices/:marketplace',
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    await db.run(
      'DELETE FROM product_prices WHERE product_id = ? AND marketplace = ?',
      req.params.id,
      req.params.marketplace,
    );
    res.status(204).send();
  }),
);

// --- Импорт из МойСклад ---

router.post(
  '/import/moysklad',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const token = req.body?.token || process.env.MOYSKLAD_TOKEN;
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
      '(sku, name, image_url, cost_price, unit, description, external_source, external_id, active)';
    const UPSERT_TAIL = `ON CONFLICT (external_source, external_id) DO UPDATE SET
        sku = COALESCE(EXCLUDED.sku, products.sku),
        name = EXCLUDED.name,
        image_url = COALESCE(EXCLUDED.image_url, products.image_url),
        cost_price = EXCLUDED.cost_price,
        unit = EXCLUDED.unit,
        description = EXCLUDED.description,
        updated_at = NOW()`;

    const upsertChunk = (chunk) => {
      const rows = chunk.map(() => "(?, ?, ?, ?, ?, ?, 'moysklad', ?, TRUE)").join(', ');
      const params = [];
      for (const p of chunk) {
        params.push(p.sku, p.name, p.imageUrl, p.costPrice, p.unit, p.description, p.externalId);
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
    res.json({ ok: true, created, updated, skipped: skipped.length, skipped_details: skipped, total: products.length });
  }),
);

// Быстрое обновление только остатков (без выгрузки самого каталога).
router.post(
  '/import/moysklad-stock',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const token = req.body?.token || process.env.MOYSKLAD_TOKEN;
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

export default router;
