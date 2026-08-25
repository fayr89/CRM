// Управление подписками пользователя на движения по складам.
// GET /api/stock-watches — мои подписки.
// PUT /api/stock-watches — заменяет все подписки: [{warehouse, watch_reserve, watch_ship, watch_receipt}].
// DELETE /api/stock-watches/:warehouse — снять подписку с склада.
// GET /api/stock-watches/warehouses — список известных складов из orders (для UI-выбора).

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT warehouse, watch_reserve, watch_ship, watch_receipt, created_at
       FROM user_stock_watches WHERE user_id = ? ORDER BY warehouse`,
      req.user.id,
    );
    res.json({ watches: rows });
  }),
);

router.get(
  '/warehouses',
  asyncHandler(async (_req, res) => {
    // Уникальные имена складов из orders + product_prices — что реально используется.
    const rows = await db.all(
      `SELECT warehouse FROM (
         SELECT DISTINCT warehouse FROM orders WHERE warehouse IS NOT NULL AND warehouse <> ''
         UNION
         SELECT DISTINCT warehouse FROM product_prices WHERE warehouse IS NOT NULL AND warehouse <> ''
       ) t ORDER BY warehouse`,
    );
    res.json({ warehouses: rows.map((r) => r.warehouse) });
  }),
);

const putSchema = z.object({
  watches: z.array(z.object({
    warehouse: z.string().min(1).max(200),
    watch_reserve: z.boolean().default(true),
    watch_ship: z.boolean().default(true),
    watch_receipt: z.boolean().default(true),
  })),
});

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const { watches } = putSchema.parse(req.body || {});
    // Полная замена: чистим и вставляем текущий набор.
    await db.withTransaction(async (tx) => {
      await tx.run(`DELETE FROM user_stock_watches WHERE user_id = ?`, req.user.id);
      for (const w of watches) {
        await tx.run(
          `INSERT INTO user_stock_watches (user_id, warehouse, watch_reserve, watch_ship, watch_receipt)
           VALUES (?, ?, ?, ?, ?)`,
          req.user.id, w.warehouse, w.watch_reserve, w.watch_ship, w.watch_receipt,
        );
      }
    });
    res.json({ ok: true, count: watches.length });
  }),
);

router.delete(
  '/:warehouse',
  asyncHandler(async (req, res) => {
    await db.run(
      `DELETE FROM user_stock_watches WHERE user_id = ? AND warehouse = ?`,
      req.user.id, decodeURIComponent(req.params.warehouse),
    );
    res.status(204).end();
  }),
);

export default router;
