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

// Ленивое создание таблицы — на случай если основная миграция ещё не прогналась
// (лямбда закеширована / rollback другого шага миграции).
async function ensureTable() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_stock_watches (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      warehouse TEXT NOT NULL,
      watch_reserve BOOLEAN NOT NULL DEFAULT TRUE,
      watch_ship BOOLEAN NOT NULL DEFAULT TRUE,
      watch_receipt BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, warehouse)
    )
  `);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      await ensureTable();
      const rows = await db.all(
        `SELECT warehouse, watch_reserve, watch_ship, watch_receipt, created_at
         FROM user_stock_watches WHERE user_id = ? ORDER BY warehouse`,
        req.user.id,
      );
      res.json({ watches: rows });
    } catch (e) {
      res.status(500).json({ error: 'stock-watches list failed', detail: e.message });
    }
  }),
);

router.get(
  '/warehouses',
  asyncHandler(async (_req, res) => {
    // Собираем склады из orders + product_prices. Каждый источник независимо
    // (если одна таблица упала — не роняем всё).
    const uniq = new Set();
    try {
      const a = await db.all(`SELECT DISTINCT warehouse FROM orders WHERE warehouse IS NOT NULL AND warehouse <> ''`);
      for (const r of a) uniq.add(r.warehouse);
    } catch (e) { /* ignore */ }
    try {
      const b = await db.all(`SELECT DISTINCT warehouse FROM product_prices WHERE warehouse IS NOT NULL AND warehouse <> ''`);
      for (const r of b) uniq.add(r.warehouse);
    } catch (e) { /* ignore */ }
    const list = Array.from(uniq).sort((a, b) => a.localeCompare(b, 'ru'));
    res.json({ warehouses: list });
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
    try {
      await ensureTable();
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
    } catch (e) {
      res.status(500).json({ error: 'stock-watches save failed', detail: e.message });
    }
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
