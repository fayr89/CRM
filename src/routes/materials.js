// Материалы — сущность производственного модуля.
// Синхронизируются в МойСклад как номенклатура «Материалы».
// Можно задать «закупочную» ед.изм. и коэффициент к основной (листания) —
// трубу покупаем в кг, храним и списываем в метрах.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { parsePagination, paginated } from '../query.js';
import { msCreate, msUpdate } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

async function syncMaterialToMs(materialId) {
  const m = await db.get('SELECT * FROM materials WHERE id = ?', materialId);
  if (!m) return;
  const token = await getMsToken();
  if (!token) {
    await db.run('UPDATE materials SET ms_sync_error = ? WHERE id = ?', 'MC token не настроен', materialId);
    return;
  }
  const simplified = { name: m.name, code: m.sku || undefined, pathName: 'Материалы' };
  try {
    if (m.ms_id) {
      await msUpdate(token, 'product', m.ms_id, simplified);
    } else {
      const created = await msCreate(token, 'product', simplified);
      await db.run('UPDATE materials SET ms_id = ?, ms_sync_error = NULL WHERE id = ?', created.id, materialId);
    }
    await db.run('UPDATE materials SET ms_sync_error = NULL, ms_synced_at = NOW() WHERE id = ?', materialId);
  } catch (e) {
    await db.run('UPDATE materials SET ms_sync_error = ? WHERE id = ?', String(e.message).slice(0, 500), materialId);
  }
}

const router = Router();
router.use(authenticate);

function canEdit(user) {
  return ['admin', 'director_prod', 'supply'].includes(user.role);
}
function canSeeCost(user) {
  return ['admin', 'director_prod', 'supply', 'foreman'].includes(user.role);
}
function stripCostForMaster(rows, user) {
  if (canSeeCost(user)) return rows;
  return rows.map((r) => {
    const { cost_price: _c, ...rest } = r; // eslint-disable-line no-unused-vars
    return rest;
  });
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = ['1=1'];
    const params = [];
    if (req.query.active === 'true') where.push('active = TRUE');
    if (req.query.active === 'false') where.push('active = FALSE');
    if (req.query.search) {
      where.push('(name ILIKE ? OR sku ILIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await db.all(
      `SELECT * FROM materials ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM materials ${whereSql}`,
      ...params,
    );
    res.json(paginated(stripCostForMaster(rows, req.user), total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM materials WHERE id = ?', req.params.id);
    if (!row) throw NotFound('Материал не найден');
    res.json(stripCostForMaster([row], req.user)[0]);
  }),
);

// unit — основная единица (в ней храним и списываем, она же в МС).
// unit_purchase — единица покупки (приход), опционально.
// purchase_to_unit_factor — сколько основных в 1 закупочной (например 6.5 м в 1 кг).
const createSchema = z.object({
  sku: z.string().max(120).optional().nullable(),
  name: z.string().min(1).max(255),
  unit: z.string().max(20).optional().default('шт'),
  unit_purchase: z.string().max(20).optional().nullable(),
  purchase_to_unit_factor: z.number().positive().optional().nullable(),
  cost_price: z.number().nonnegative().optional().default(0),
  supplier: z.string().max(120).optional().nullable(),
  warehouse: z.string().max(120).optional().nullable(),
  active: z.boolean().optional().default(true),
  notes: z.string().max(1000).optional().nullable(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или снабжению');
    const data = createSchema.parse(req.body || {});
    const r = await db.run(
      `INSERT INTO materials (sku, name, unit, unit_purchase, purchase_to_unit_factor, cost_price, supplier, warehouse, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.sku ?? null, data.name, data.unit || 'шт', data.unit_purchase ?? null, data.purchase_to_unit_factor ?? null,
      data.cost_price || 0, data.supplier ?? null, data.warehouse ?? null, data.active !== false,
      data.notes ?? null,
    );
    const created = await db.get('SELECT * FROM materials WHERE id = ?', r.lastInsertRowid);
    await logAction(req, { action: 'material.created', entity_type: 'material', entity_id: created.id });
    await syncMaterialToMs(created.id);
    const final = await db.get('SELECT * FROM materials WHERE id = ?', created.id);
    res.status(201).json(final);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или снабжению');
    const data = createSchema.partial().parse(req.body || {});
    const cur = await db.get('SELECT * FROM materials WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Материал не найден');
    const updates = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) {
      updates.push(`${k} = ?`);
      params.push(v ?? null);
    }
    if (!updates.length) return res.json(cur);
    updates.push('updated_at = NOW()');
    params.push(cur.id);
    await db.run(`UPDATE materials SET ${updates.join(', ')} WHERE id = ?`, ...params);
    await logAction(req, { action: 'material.updated', entity_type: 'material', entity_id: cur.id, details: { fields: Object.keys(data) } });
    if (data.name !== undefined || data.sku !== undefined || data.cost_price !== undefined) {
      await syncMaterialToMs(cur.id);
    }
    const updated = await db.get('SELECT * FROM materials WHERE id = ?', cur.id);
    res.json(updated);
  }),
);

router.post(
  '/:id/sync-ms',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или снабжению');
    const cur = await db.get('SELECT id FROM materials WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Материал не найден');
    await syncMaterialToMs(cur.id);
    const updated = await db.get('SELECT * FROM materials WHERE id = ?', cur.id);
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT id FROM materials WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Материал не найден');
    const refs = await db.get(
      `SELECT
         (SELECT COUNT(*)::int FROM processing_plan_items WHERE material_id = ?) AS plans,
         (SELECT COUNT(*)::int FROM contract_materials WHERE material_id = ?) AS contracts`,
      cur.id, cur.id,
    );
    if ((refs?.plans || 0) > 0 || (refs?.contracts || 0) > 0) {
      await db.run('UPDATE materials SET active = FALSE, updated_at = NOW() WHERE id = ?', cur.id);
      await logAction(req, { action: 'material.archived', entity_type: 'material', entity_id: cur.id, details: refs });
      return res.json({ archived: true, refs });
    }
    await db.run('DELETE FROM materials WHERE id = ?', cur.id);
    await logAction(req, { action: 'material.deleted', entity_type: 'material', entity_id: cur.id });
    res.status(204).send();
  }),
);

export default router;
