// Оприходование материалов/товаров на внутренний склад производства
// через entity/enter в МойСклад.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { msCreate, msHref } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();
router.use(authenticate);

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

const schema = z.object({
  type: z.enum(['material', 'product']),
  id: z.number().int().positive(),
  qty: z.number().positive(),
  price: z.number().nonnegative().optional().default(0),
});

router.post(
  '/',
  requireRole('admin', 'director_prod', 'supply', 'foreman'),
  asyncHandler(async (req, res) => {
    const data = schema.parse(req.body || {});

    const token = await getMsToken();
    if (!token) throw BadRequest('Токен МС не настроен');
    const orgRow = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.organization_id'`).catch(() => null);
    const orgId = orgRow?.value;
    if (!orgId) throw BadRequest('Организация МС не инициализирована (Настройки → Интеграции → МС → Инициализировать)');
    const whRow = await db.get(`SELECT value FROM app_settings WHERE key = 'production.internal_warehouse'`).catch(() => null);
    const wh = whRow?.value;
    if (!wh?.id) throw BadRequest('Внутренний склад производства не задан (Настройки → Производство)');

    let msId = null;
    let name = null;
    if (data.type === 'material') {
      const m = await db.get('SELECT id, name, ms_id FROM materials WHERE id = ?', data.id);
      if (!m) throw NotFound('Материал не найден');
      msId = m.ms_id;
      name = m.name;
      if (!msId) throw BadRequest('У материала нет ms_id — в карточке нажмите «🔄 Синхронизировать с МС»');
    } else {
      const p = await db.get('SELECT id, name, external_id, external_source, stock_by_store FROM products WHERE id = ?', data.id);
      if (!p) throw NotFound('Товар не найден');
      msId = p.external_source === 'moysklad' ? p.external_id : null;
      name = p.name;
      if (!msId) throw BadRequest('У товара нет external_id (МС) — нужно импортировать карточку из МС');
    }

    // Минимальный body для entity/enter: только обязательные поля
    // (organization, store, positions). moment и description опциональны —
    // если МС не нравится их формат, лучше пусть автогенерирует.
    const body = {
      organization: { meta: { href: msHref('organization', orgId), type: 'organization', mediaType: 'application/json' } },
      store: { meta: { href: msHref('store', wh.id), type: 'store', mediaType: 'application/json' } },
      positions: [{
        assortment: { meta: { href: msHref('product', msId), type: 'product', mediaType: 'application/json' } },
        quantity: data.qty,
        price: Math.round((data.price || 0) * 100),
      }],
    };
    let created;
    try {
      created = await msCreate(token, 'enter', body);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[production/receipt] МС-ошибка:', e?.message, '| body:', JSON.stringify(body));
      // Возвращаем максимум деталей — пользователю видно что не так.
      throw BadRequest('МС-ошибка при создании прихода: ' + (e?.message || 'unknown'));
    }

    if (data.type === 'product') {
      const p = await db.get('SELECT stock_by_store FROM products WHERE id = ?', data.id);
      let sbs = Array.isArray(p?.stock_by_store) ? [...p.stock_by_store]
        : (typeof p?.stock_by_store === 'string' ? JSON.parse(p.stock_by_store || '[]') : []);
      const idx = sbs.findIndex((s) => String(s.store || '').trim() === wh.name);
      if (idx >= 0) {
        sbs[idx] = { ...sbs[idx], stock: Number(sbs[idx].stock || 0) + data.qty };
      } else {
        sbs.push({ store: wh.name, stock: data.qty, reserve: 0 });
      }
      await db.run(
        `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
        JSON.stringify(sbs), data.id,
      ).catch(() => { /* ignore */ });
    }

    await logAction(req, {
      action: 'production.receipt',
      entity_type: data.type,
      entity_id: data.id,
      details: { qty: data.qty, price: data.price, ms_document_id: created.id, warehouse: wh.name },
    });

    res.json({
      ok: true,
      ms_document: { id: created.id, name: created.name },
      type: data.type, id: data.id, name, qty: data.qty, price: data.price,
      warehouse: wh,
    });
  }),
);

export default router;
