// TEMP: показать список складов из stock_by_store + основные настройки.
// Снести сразу после проверки. token = диагностический одноразовый секрет.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '7e2a4c81f9b5d3e8a6c1b4f7d2e9a8b3';

router.get(
  '/warehouses',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const rows = await db.all(
      `SELECT DISTINCT el->>'store' AS store
       FROM products p, jsonb_array_elements(p.stock_by_store) AS el
       WHERE p.stock_by_store IS NOT NULL AND jsonb_typeof(p.stock_by_store) = 'array'
       ORDER BY store`,
    );
    const all = rows.map((r) => r.store).filter(Boolean);
    const hidden = await db.get(`SELECT value FROM app_settings WHERE key = 'warehouses.hidden'`).catch(() => null);
    const defWriteoff = await db.get(`SELECT value FROM app_settings WHERE key = 'warehouses.default_writeoff'`).catch(() => null);
    const intProd = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
    const laborRate = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
    res.json({
      all,
      count: all.length,
      contains_novosibirsk: all.filter((s) => /новосиб|нск|sofia|софий/i.test(s)),
      hidden: hidden?.value || null,
      default_writeoff: defWriteoff?.value || null,
      production_internal_warehouse: intProd?.value || null,
      production_labor_rate_per_minute: laborRate?.value || null,
    });
  }),
);

export default router;
