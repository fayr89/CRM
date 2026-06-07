// Подряды (клиентские заказы на изготовление): этапы, материалы, труд,
// прочие расходы → P&L = paid − (materials + labor + other).
// Этапы зафиксированы enum-ом: measure → cut → weld → paint → ship.
// Master видит только подряды где он назначен manager_id.
// Цены/себестоимость/прибыль НЕ отдаются master-у — фильтруем поля.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();
router.use(authenticate);

const STAGES = ['measure', 'cut', 'weld', 'paint', 'ship'];

function canEdit(user) {
  return ['admin', 'director_prod'].includes(user.role);
}
function isMaster(user) {
  return user.role === 'master';
}
function canSeeMoney(user) {
  // Маржа/оплата/себестоимость — только владельцу/директору. Foreman/supply
  // видят только себестоимость материалов в составе (если уж зашли в карточку).
  return ['admin', 'director_prod'].includes(user.role);
}

function stripMoney(obj, user) {
  if (canSeeMoney(user)) return obj;
  const { total_amount: _ta, paid_amount: _pa, ...rest } = obj; // eslint-disable-line no-unused-vars
  return rest;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (req.query.status) { where.push('c.status = ?'); params.push(String(req.query.status)); }
    if (req.query.manager_id) { where.push('c.manager_id = ?'); params.push(Number(req.query.manager_id)); }
    if (req.query.search) {
      where.push('(c.client_name ILIKE ? OR c.client_company ILIKE ? OR c.description ILIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s, s);
    }
    // Master видит только свои.
    if (isMaster(req.user)) {
      where.push('c.manager_id = ?');
      params.push(req.user.id);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT c.*, u.name AS manager_name
       FROM contracts c LEFT JOIN users u ON u.id = c.manager_id
       ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const { total } = await db.get(`SELECT COUNT(*)::int AS total FROM contracts c ${whereSql}`, ...params);
    res.json(paginated(rows.map((r) => stripMoney(r, req.user)), total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const contract = await db.get(
      `SELECT c.*, u.name AS manager_name FROM contracts c LEFT JOIN users u ON u.id = c.manager_id WHERE c.id = ?`,
      req.params.id,
    );
    if (!contract) throw NotFound('Подряд не найден');
    if (isMaster(req.user) && contract.manager_id !== req.user.id) throw NotFound('Подряд не найден');
    const stages = await db.all(
      `SELECT cs.*, u.name AS closed_by_name FROM contract_stages cs
       LEFT JOIN users u ON u.id = cs.closed_by
       WHERE cs.contract_id = ?`,
      contract.id,
    );
    // Дополняем недостающие этапы из STAGES — UI ожидает 5 строк.
    const byStage = new Map(stages.map((s) => [s.stage, s]));
    contract.stages = STAGES.map((s) => byStage.get(s) || { stage: s, plan_date: null, fact_date: null });
    if (canSeeMoney(req.user)) {
      const materials = await db.all(
        `SELECT cm.*, m.name AS material_name, m.sku AS material_sku, m.unit AS material_unit
         FROM contract_materials cm JOIN materials m ON m.id = cm.material_id
         WHERE cm.contract_id = ? ORDER BY cm.consumed_at`,
        contract.id,
      );
      const labor = await db.all(
        `SELECT cl.*, u.name AS performed_by_name FROM contract_labor_logs cl
         LEFT JOIN users u ON u.id = cl.performed_by
         WHERE cl.contract_id = ? ORDER BY cl.performed_at`,
        contract.id,
      );
      const other = await db.all(
        'SELECT * FROM contract_other_expenses WHERE contract_id = ? ORDER BY spent_at',
        contract.id,
      );
      contract.materials = materials;
      contract.labor = labor;
      contract.other_expenses = other;
      const matSum = materials.reduce((s, m) => s + Number(m.qty || 0) * Number(m.unit_price || 0), 0);
      const laborSum = labor.reduce((s, l) => s + Number(l.amount || 0), 0);
      const otherSum = other.reduce((s, o) => s + Number(o.amount || 0), 0);
      contract.cost_total = Math.round((matSum + laborSum + otherSum) * 100) / 100;
      contract.margin = Math.round((Number(contract.paid_amount || 0) - contract.cost_total) * 100) / 100;
    }
    res.json(stripMoney(contract, req.user));
  }),
);

const createSchema = z.object({
  client_name: z.string().min(1).max(255),
  client_phone: z.string().max(60).optional().nullable(),
  client_company: z.string().max(255).optional().nullable(),
  total_amount: z.number().nonnegative().optional().default(0),
  currency: z.string().length(3).optional().default('RUB'),
  manager_id: z.number().int().positive().optional().nullable(),
  // Привязка к проекту — для попадания доходов/расходов в P&L производства,
  // когда у проекта is_production=true (например ЧПБ — полимерная краска).
  project_id: z.number().int().positive().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // На старте автоматически создаём 5 пустых этапов; даты можно задать сразу.
  stages: z.array(z.object({
    stage: z.enum(STAGES),
    plan_date: z.string().optional().nullable(),
  })).optional().default([]),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу или директору производства');
    const data = createSchema.parse(req.body || {});
    const created = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO contracts (client_name, client_phone, client_company, total_amount, currency,
          manager_id, project_id, description, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft') RETURNING id`,
        data.client_name, data.client_phone ?? null, data.client_company ?? null,
        data.total_amount || 0, data.currency || 'RUB',
        data.manager_id ?? null, data.project_id ?? null,
        data.description ?? null, data.notes ?? null,
      );
      const id = r.lastInsertRowid;
      // Заводим 5 этапов сразу — пустыми. Даты можно потом обновить.
      const byStage = new Map((data.stages || []).map((s) => [s.stage, s]));
      for (const s of STAGES) {
        const supplied = byStage.get(s);
        await tx.run(
          `INSERT INTO contract_stages (contract_id, stage, plan_date) VALUES (?, ?, ?::date)`,
          id, s, supplied?.plan_date ?? null,
        );
      }
      return id;
    });
    await logAction(req, { action: 'contract.created', entity_type: 'contract', entity_id: created });
    res.status(201).json(await db.get('SELECT * FROM contracts WHERE id = ?', created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!canEdit(req.user)) throw BadRequest('Доступ только админу или директору производства');
    const data = createSchema.partial().omit({ stages: true }).extend({
      paid_amount: z.number().nonnegative().optional(),
      status: z.enum(['draft', 'in_progress', 'done', 'cancelled']).optional(),
    }).parse(req.body || {});
    const cur = await db.get('SELECT * FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    const updates = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) {
      updates.push(`${k} = ?`);
      params.push(v ?? null);
    }
    if (!updates.length) return res.json(cur);
    updates.push('updated_at = NOW()');
    params.push(cur.id);
    await db.run(`UPDATE contracts SET ${updates.join(', ')} WHERE id = ?`, ...params);
    await logAction(req, { action: 'contract.updated', entity_type: 'contract', entity_id: cur.id, details: { fields: Object.keys(data) } });
    res.json(await db.get('SELECT * FROM contracts WHERE id = ?', cur.id));
  }),
);

// Обновить этап: plan_date или закрыть (fact_date + closed_by). Закрывать может
// master/foreman/director, менять plan_date — только foreman+.
router.patch(
  '/:id/stages/:stage',
  asyncHandler(async (req, res) => {
    const stage = String(req.params.stage);
    if (!STAGES.includes(stage)) throw BadRequest('Неизвестный этап');
    const cur = await db.get('SELECT * FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    const data = z.object({
      plan_date: z.string().optional().nullable(),
      close: z.boolean().optional(),
      note: z.string().max(500).optional().nullable(),
    }).parse(req.body || {});
    const sRow = await db.get(
      'SELECT * FROM contract_stages WHERE contract_id = ? AND stage = ?',
      cur.id, stage,
    );
    if (!sRow) throw NotFound('Этап не найден');
    const updates = [];
    const params = [];
    if (data.plan_date !== undefined) {
      if (!['admin', 'director_prod', 'foreman'].includes(req.user.role)) {
        throw BadRequest('Изменять план может директор/начальник цеха');
      }
      updates.push('plan_date = ?::date');
      params.push(data.plan_date);
    }
    if (data.close === true) {
      if (!['admin', 'director_prod', 'foreman', 'master'].includes(req.user.role)) {
        throw BadRequest('Закрывать этап могут производственные роли');
      }
      updates.push('fact_date = CURRENT_DATE', 'closed_by = ?', 'closed_at = NOW()');
      params.push(req.user.id);
    }
    if (data.note !== undefined) {
      updates.push('note = ?');
      params.push(data.note);
    }
    if (!updates.length) return res.json(sRow);
    params.push(sRow.id);
    await db.run(`UPDATE contract_stages SET ${updates.join(', ')} WHERE id = ?`, ...params);
    await logAction(req, {
      action: data.close ? 'contract.stage_closed' : 'contract.stage_updated',
      entity_type: 'contract', entity_id: cur.id,
      details: { stage, closed: !!data.close, plan_date: data.plan_date ?? null },
    });
    res.json(await db.get('SELECT * FROM contract_stages WHERE id = ?', sRow.id));
  }),
);

// Списать материал на подряд (фактический расход).
const matSchema = z.object({
  material_id: z.number().int().positive(),
  qty: z.number().positive(),
  unit_price: z.number().nonnegative(),
  note: z.string().max(500).optional().nullable(),
});
router.post(
  '/:id/materials',
  requireRole('admin', 'director_prod', 'foreman'),
  asyncHandler(async (req, res) => {
    const data = matSchema.parse(req.body || {});
    const cur = await db.get('SELECT id FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    const r = await db.run(
      `INSERT INTO contract_materials (contract_id, material_id, qty, unit_price, consumed_by, note)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      cur.id, data.material_id, data.qty, data.unit_price, req.user.id, data.note ?? null,
    );
    await logAction(req, { action: 'contract.material_consumed', entity_type: 'contract', entity_id: cur.id, details: { material_id: data.material_id, qty: data.qty } });
    res.status(201).json({ id: r.lastInsertRowid });
  }),
);

// Записать труд по подряду.
const laborSchema = z.object({
  minutes: z.number().positive(),
  rate_per_minute: z.number().nonnegative().optional(),
  note: z.string().max(500).optional().nullable(),
});
router.post(
  '/:id/labor',
  requireRole('admin', 'director_prod', 'foreman', 'master'),
  asyncHandler(async (req, res) => {
    const data = laborSchema.parse(req.body || {});
    const cur = await db.get('SELECT id FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    // Если ставка не передана — берём дефолтную из app_settings.
    let rate = data.rate_per_minute;
    if (rate == null) {
      const row = await db.get(`SELECT value FROM app_settings WHERE key = 'production.labor_rate_per_minute'`).catch(() => null);
      rate = Number(row?.value) || 0;
    }
    const amount = Math.round(data.minutes * rate * 100) / 100;
    const r = await db.run(
      `INSERT INTO contract_labor_logs (contract_id, minutes, rate_per_minute, amount, performed_by, note)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      cur.id, data.minutes, rate, amount, req.user.id, data.note ?? null,
    );
    await logAction(req, { action: 'contract.labor_logged', entity_type: 'contract', entity_id: cur.id, details: { minutes: data.minutes, amount } });
    res.status(201).json({ id: r.lastInsertRowid, amount });
  }),
);

// Прочие прямые расходы (доставка, разовые услуги и т.п.).
const otherSchema = z.object({
  amount: z.number().nonnegative(),
  kind: z.string().max(60).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});
router.post(
  '/:id/other-expenses',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const data = otherSchema.parse(req.body || {});
    const cur = await db.get('SELECT id FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    const r = await db.run(
      `INSERT INTO contract_other_expenses (contract_id, amount, kind, note, recorded_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      cur.id, data.amount, data.kind ?? null, data.note ?? null, req.user.id,
    );
    await logAction(req, { action: 'contract.other_expense', entity_type: 'contract', entity_id: cur.id, details: data });
    res.status(201).json({ id: r.lastInsertRowid });
  }),
);

router.delete(
  '/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT * FROM contracts WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Подряд не найден');
    if (cur.status !== 'draft') {
      await db.run(`UPDATE contracts SET status = 'cancelled', updated_at = NOW() WHERE id = ?`, cur.id);
      await logAction(req, { action: 'contract.cancelled', entity_type: 'contract', entity_id: cur.id });
      return res.json({ cancelled: true });
    }
    await db.run('DELETE FROM contracts WHERE id = ?', cur.id);
    await logAction(req, { action: 'contract.deleted', entity_type: 'contract', entity_id: cur.id });
    res.status(204).send();
  }),
);

export default router;
