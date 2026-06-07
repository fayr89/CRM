// Техкарты: товар + норма труда (минуты на 1 ед) + список (материал, норма на 1 ед).
// CRUD + расчёт себестоимости 1 ед = Σ(material.cost_price × qty_per_unit) + (labor_minutes × labor_rate).
// labor_rate берётся из app_settings.production.labor_rate_per_minute.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();
router.use(authenticate);

function canEdit(user) {
  return ['admin', 'director_prod', 'foreman'].includes(user.role);
}
function canSeeCost(user) {
  return ['admin', 'director_prod', 'foreman', 'supply'].includes(user.role);
}

async function getLaborRate() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
  return Number(row?.value) || 0;
}

async function loadPlanFull(planId, includeCost) {
  const plan = await db.get(`SELECT pp.*, p.name AS product_name, p.sku AS product_sku
                             FROM processing_plans pp JOIN products p ON p.id = pp.product_id
                             WHERE pp.id = ?`, planId);
  if (!plan) return null;
  const items = await db.all(
    `SELECT pi.id, pi.material_id, pi.qty_per_unit, m.name AS material_name, m.sku AS material_sku,
            m.unit AS material_unit${includeCost ? ', m.cost_price' : ''}
     FROM processing_plan_items pi JOIN materials m ON m.id = pi.material_id
     WHERE pi.plan_id = ? ORDER BY pi.id`,
    planId,
  );
  plan.items = items;
  // Этапы: имя + минуты на этап. Эффективное время труда — сумма по этапам;
  // если этапов нет, fallback на labor_minutes_per_unit поля плана.
  const stages = await db.all(
    `SELECT id, name, minutes, sort_order FROM processing_plan_stages
     WHERE plan_id = ? ORDER BY sort_order ASC, id ASC`,
    planId,
  );
  plan.stages = stages;
  const stagesTotal = stages.reduce((s, x) => s + Number(x.minutes || 0), 0);
  const effectiveLaborMinutes = stages.length ? stagesTotal : Number(plan.labor_minutes_per_unit || 0);
  plan.effective_labor_minutes = Math.round(effectiveLaborMinutes * 100) / 100;
  if (includeCost) {
    const rate = await getLaborRate();
    const materialsTotal = items.reduce((s, i) => s + Number(i.cost_price || 0) * Number(i.qty_per_unit || 0), 0);
    const laborTotal = effectiveLaborMinutes * rate;
    plan.cost_per_unit = Math.round((materialsTotal + laborTotal) * 100) / 100;
    plan.materials_total_per_unit = Math.round(materialsTotal * 100) / 100;
    plan.labor_total_per_unit = Math.round(laborTotal * 100) / 100;
    plan.labor_rate_per_minute = rate;
  }
  return plan;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeCost = canSeeCost(req.user);
    const rows = await db.all(
      `SELECT pp.id, pp.product_id, pp.labor_minutes_per_unit, pp.active, pp.ms_id, pp.updated_at,
              p.name AS product_name, p.sku AS product_sku
       FROM processing_plans pp JOIN products p ON p.id = pp.product_id
       ${req.query.active === 'false' ? 'WHERE pp.active = FALSE' : req.query.active === 'true' ? 'WHERE pp.active = TRUE' : ''}
       ORDER BY p.name ASC`,
    );
    // Подтянем суммарное время этапов — если есть, перекрывает labor_minutes_per_unit.
    const stagesAgg = await db.all(
      `SELECT plan_id, SUM(minutes) AS minutes_sum FROM processing_plan_stages GROUP BY plan_id`,
    );
    const stagesByPlan = new Map(stagesAgg.map((x) => [Number(x.plan_id), Number(x.minutes_sum) || 0]));
    for (const r of rows) {
      const stMin = stagesByPlan.get(Number(r.id));
      r.effective_labor_minutes = stMin != null ? Math.round(stMin * 100) / 100 : Number(r.labor_minutes_per_unit || 0);
    }
    if (!includeCost) return res.json({ data: rows });
    const rate = await getLaborRate();
    // Подтянем суммарную себестоимость для каждой техкарты одной выборкой.
    const items = await db.all(
      `SELECT pi.plan_id, SUM(m.cost_price * pi.qty_per_unit) AS materials_total
       FROM processing_plan_items pi JOIN materials m ON m.id = pi.material_id
       GROUP BY pi.plan_id`,
    );
    const byPlan = new Map(items.map((x) => [Number(x.plan_id), Number(x.materials_total) || 0]));
    for (const r of rows) {
      const mat = byPlan.get(Number(r.id)) || 0;
      const labor = Number(r.effective_labor_minutes || 0) * rate;
      r.cost_per_unit = Math.round((mat + labor) * 100) / 100;
    }
    res.json({ data: rows, labor_rate_per_minute: rate });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const plan = await loadPlanFull(req.params.id, canSeeCost(req.user));
    if (!plan) throw NotFound('Техкарта не найдена');
    res.json(plan);
  }),
);

const itemSchema = z.object({
  material_id: z.number().int().positive(),
  qty_per_unit: z.number().positive(),
});
const stageSchema = z.object({
  name: z.string().min(1).max(100),
  minutes: z.number().nonnegative(),
});
const planSchema = z.object({
  product_id: z.number().int().positive(),
  // labor_minutes_per_unit оставлено для обратной совместимости. Если в payload
  // приходят stages — labor_minutes_per_unit игнорируется и считается как
  // SUM(stages.minutes) при чтении.
  labor_minutes_per_unit: z.number().nonnegative().optional().default(0),
  active: z.boolean().optional().default(true),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(itemSchema).optional().default([]),
  stages: z.array(stageSchema).optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или начальнику цеха');
    const data = planSchema.parse(req.body || {});
    const exists = await db.get('SELECT id FROM processing_plans WHERE product_id = ?', data.product_id);
    if (exists) throw BadRequest('Для этого товара уже есть техкарта');
    const created = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO processing_plans (product_id, labor_minutes_per_unit, active, notes)
         VALUES (?, ?, ?, ?) RETURNING id`,
        data.product_id, data.labor_minutes_per_unit || 0, data.active !== false, data.notes ?? null,
      );
      const planId = r.lastInsertRowid;
      for (const it of data.items) {
        await tx.run(
          `INSERT INTO processing_plan_items (plan_id, material_id, qty_per_unit) VALUES (?, ?, ?)`,
          planId, it.material_id, it.qty_per_unit,
        );
      }
      if (data.stages && data.stages.length) {
        for (let i = 0; i < data.stages.length; i++) {
          const s = data.stages[i];
          await tx.run(
            `INSERT INTO processing_plan_stages (plan_id, name, minutes, sort_order) VALUES (?, ?, ?, ?)`,
            planId, s.name, s.minutes, i,
          );
        }
      }
      return planId;
    });
    const plan = await loadPlanFull(created, canSeeCost(req.user));
    await logAction(req, { action: 'processing_plan.created', entity_type: 'processing_plan', entity_id: created });
    res.status(201).json(plan);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу, директору производства или начальнику цеха');
    const data = planSchema.partial().parse(req.body || {});
    const cur = await db.get('SELECT * FROM processing_plans WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Техкарта не найдена');
    await db.withTransaction(async (tx) => {
      const updates = [];
      const params = [];
      for (const k of ['labor_minutes_per_unit', 'active', 'notes']) {
        if (data[k] !== undefined) {
          updates.push(`${k} = ?`);
          params.push(data[k] ?? null);
        }
      }
      if (updates.length) {
        updates.push('updated_at = NOW()');
        params.push(cur.id);
        await tx.run(`UPDATE processing_plans SET ${updates.join(', ')} WHERE id = ?`, ...params);
      }
      // Если переданы items — полностью переписываем (проще диффа).
      if (data.items) {
        await tx.run('DELETE FROM processing_plan_items WHERE plan_id = ?', cur.id);
        for (const it of data.items) {
          await tx.run(
            `INSERT INTO processing_plan_items (plan_id, material_id, qty_per_unit) VALUES (?, ?, ?)`,
            cur.id, it.material_id, it.qty_per_unit,
          );
        }
      }
      // Та же логика для этапов: если передан массив — перезаписываем целиком.
      if (data.stages) {
        await tx.run('DELETE FROM processing_plan_stages WHERE plan_id = ?', cur.id);
        for (let i = 0; i < data.stages.length; i++) {
          const s = data.stages[i];
          await tx.run(
            `INSERT INTO processing_plan_stages (plan_id, name, minutes, sort_order) VALUES (?, ?, ?, ?)`,
            cur.id, s.name, s.minutes, i,
          );
        }
      }
    });
    const plan = await loadPlanFull(cur.id, canSeeCost(req.user));
    await logAction(req, { action: 'processing_plan.updated', entity_type: 'processing_plan', entity_id: cur.id });
    res.json(plan);
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT id FROM processing_plans WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Техкарта не найдена');
    await db.run('DELETE FROM processing_plans WHERE id = ?', cur.id);
    await logAction(req, { action: 'processing_plan.deleted', entity_type: 'processing_plan', entity_id: cur.id });
    res.status(204).send();
  }),
);

export default router;
