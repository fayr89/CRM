// Настройки производственного модуля: внутренний склад (для оприходования
// готовых товаров и хранения материалов в МС) + ставка труда ₽/мин.
// Также — справочник МС-складов (всех, активных) для выпадашки в настройках.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { msFetchStores } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();
router.use(authenticate);

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

// Список складов из МС (имя + id). Кешируется в app_settings.ms_stores_cache
// на 1 час — не тянем МС на каждый рендер настроек.
router.get(
  '/ms-stores',
  asyncHandler(async (req, res) => {
    const force = req.query.refresh === '1';
    if (!force) {
      const cache = await db.get(`SELECT value FROM app_settings WHERE key = 'ms_stores_cache'`).catch(() => null);
      if (cache?.value?.fetched_at && Date.now() - new Date(cache.value.fetched_at).getTime() < 3600 * 1000) {
        return res.json({ stores: cache.value.stores, cached: true });
      }
    }
    const token = await getMsToken();
    if (!token) throw BadRequest('Токен МС не настроен');
    const all = await msFetchStores(token);
    const stores = all.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }));
    await db.run(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('ms_stores_cache', ?::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      JSON.stringify({ stores, fetched_at: new Date().toISOString() }),
    );
    res.json({ stores, cached: false });
  }),
);

// Получить настройки.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const warehouseRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
    const rateRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
    res.json({
      internal_warehouse: warehouseRow?.value || null,
      labor_rate_per_minute: rateRow?.value || null,
    });
  }),
);

const settingsSchema = z.object({
  internal_warehouse: z.object({
    id: z.string(),
    name: z.string(),
  }).optional().nullable(),
  labor_rate_per_minute: z.number().nonnegative().optional().nullable(),
});

router.put(
  '/',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const data = settingsSchema.parse(req.body || {});
    if (data.internal_warehouse !== undefined) {
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('production.internal_warehouse', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(data.internal_warehouse),
      );
    }
    if (data.labor_rate_per_minute !== undefined) {
      await db.run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('production.labor_rate_per_minute', ?::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        JSON.stringify(data.labor_rate_per_minute ?? null),
      );
    }
    await logAction(req, { action: 'production_settings.updated', entity_type: 'app_settings', entity_id: null, details: Object.keys(data) });
    res.json({ ok: true });
  }),
);

export default router;
