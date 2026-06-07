// P&L производства: доход (сделки/заказы/подряды по производственным проектам)
// минус расход (контрактные материалы/труд/прочие + ручные production_expenses).
// Доступен admin и director_prod. Foreman/master/supply этого не видят.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();
router.use(authenticate);

function canSee(user) {
  return ['admin', 'director_prod'].includes(user.role);
}

// GET /api/production/p-and-l?from=YYYY-MM-DD&to=YYYY-MM-DD
// Считает доход и расход за период.
// Доход = (подтверждённые payments по orders с production-project)
//       + (paid_amount подрядов с production-project, deltas в периоде через created_at).
// Расход = (материалы + труд + прочие у production-подрядов)
//        + (production_expenses в периоде).
router.get(
  '/p-and-l',
  asyncHandler(async (req, res) => {
    if (!canSee(req.user)) throw BadRequest('Доступно админу и директору производства');
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    // Если границы не заданы — берём текущий месяц по UTC.
    const today = new Date();
    const defaultFrom = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const fromD = from || defaultFrom;
    const toD = to || today.toISOString().slice(0, 10);

    // Производственные проекты.
    const projects = await db.all(
      `SELECT id, name, color FROM projects WHERE is_production = TRUE AND active = TRUE`,
    );
    const projectIds = projects.map((p) => p.id);
    if (!projectIds.length) {
      return res.json({
        from: fromD, to: toD,
        production_projects: [],
        income: { total: 0, by_source: { orders: 0, contracts: 0 }, by_project: [] },
        expense: { total: 0, by_source: { contract_costs: 0, manual: 0 }, by_project: [], manual: [] },
        profit: 0,
      });
    }

    // 1. Доход через payments (подтверждённые) от orders с производственным проектом.
    //    Это самое надёжное: реально полученные деньги. status='confirmed' + дата в окне.
    const orderIncomeRows = await db.all(
      `SELECT pr.id AS project_id, pr.name AS project_name, pr.color,
              COALESCE(SUM(p.amount), 0)::float AS amount
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       JOIN projects pr ON pr.id = o.project_id
       WHERE pr.id = ANY(?) AND p.status = 'confirmed' AND p.kind = 'income'
         AND p.created_at::date >= ?::date AND p.created_at::date <= ?::date
       GROUP BY pr.id, pr.name, pr.color`,
      projectIds, fromD, toD,
    );

    // 2. Доход через подряды: paid_amount у contracts с production-project (тех, что
    //    finished в окне или активны и paid_amount > 0). Считаем целиком paid_amount
    //    для активных и завершённых подрядов — это «уже полученные деньги».
    //    Фильтр по периоду через updated_at (когда paid_amount изменился последний раз).
    const contractIncomeRows = await db.all(
      `SELECT pr.id AS project_id, pr.name AS project_name, pr.color,
              COALESCE(SUM(c.paid_amount), 0)::float AS amount
       FROM contracts c
       JOIN projects pr ON pr.id = c.project_id
       WHERE pr.id = ANY(?) AND c.status != 'cancelled'
         AND c.updated_at::date >= ?::date AND c.updated_at::date <= ?::date
       GROUP BY pr.id, pr.name, pr.color`,
      projectIds, fromD, toD,
    );

    // 3. Расход подрядов: материалы + труд + прочие. Только для подрядов с
    //    производственным проектом, по записям в окне.
    const contractCostsRows = await db.all(
      `SELECT pr.id AS project_id, pr.name AS project_name,
              COALESCE(SUM(t.amount), 0)::float AS amount
       FROM (
         SELECT c.project_id, cm.qty * cm.unit_price AS amount
         FROM contract_materials cm JOIN contracts c ON c.id = cm.contract_id
         WHERE cm.consumed_at::date >= ?::date AND cm.consumed_at::date <= ?::date
         UNION ALL
         SELECT c.project_id, cl.amount
         FROM contract_labor_logs cl JOIN contracts c ON c.id = cl.contract_id
         WHERE cl.performed_at::date >= ?::date AND cl.performed_at::date <= ?::date
         UNION ALL
         SELECT c.project_id, ce.amount
         FROM contract_other_expenses ce JOIN contracts c ON c.id = ce.contract_id
         WHERE ce.spent_at::date >= ?::date AND ce.spent_at::date <= ?::date
       ) t JOIN projects pr ON pr.id = t.project_id
       WHERE pr.id = ANY(?)
       GROUP BY pr.id, pr.name`,
      fromD, toD, fromD, toD, fromD, toD, projectIds,
    );

    // 4. Ручные расходы в окне.
    const manualExpensesRows = await db.all(
      `SELECT id, amount, category, description, spent_at, recorded_by
       FROM production_expenses
       WHERE spent_at >= ?::date AND spent_at <= ?::date
       ORDER BY spent_at DESC, id DESC`,
      fromD, toD,
    );
    const manualTotal = manualExpensesRows.reduce((s, r) => s + Number(r.amount || 0), 0);

    // Собираем по проектам.
    const byProject = new Map();
    for (const p of projects) byProject.set(p.id, { id: p.id, name: p.name, color: p.color, income: 0, expense: 0 });
    for (const r of orderIncomeRows) byProject.get(r.project_id).income += Number(r.amount || 0);
    for (const r of contractIncomeRows) byProject.get(r.project_id).income += Number(r.amount || 0);
    for (const r of contractCostsRows) byProject.get(r.project_id).expense += Number(r.amount || 0);

    const ordersTotal = orderIncomeRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const contractsTotal = contractIncomeRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const contractCostsTotal = contractCostsRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const incomeTotal = ordersTotal + contractsTotal;
    const expenseTotal = contractCostsTotal + manualTotal;

    res.json({
      from: fromD, to: toD,
      production_projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
      income: {
        total: Math.round(incomeTotal * 100) / 100,
        by_source: {
          orders: Math.round(ordersTotal * 100) / 100,
          contracts: Math.round(contractsTotal * 100) / 100,
        },
        by_project: Array.from(byProject.values()).map((p) => ({ id: p.id, name: p.name, color: p.color, income: Math.round(p.income * 100) / 100 })),
      },
      expense: {
        total: Math.round(expenseTotal * 100) / 100,
        by_source: {
          contract_costs: Math.round(contractCostsTotal * 100) / 100,
          manual: Math.round(manualTotal * 100) / 100,
        },
        by_project: Array.from(byProject.values()).map((p) => ({ id: p.id, name: p.name, color: p.color, expense: Math.round(p.expense * 100) / 100 })),
        manual: manualExpensesRows,
      },
      profit: Math.round((incomeTotal - expenseTotal) * 100) / 100,
    });
  }),
);

// ===== Ручные расходы производства =====
// Список расходов за период. Доступ — admin/director_prod.
router.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    if (!canSee(req.user)) throw BadRequest('Доступно админу и директору производства');
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const where = [];
    const params = [];
    if (from) { where.push('spent_at >= ?::date'); params.push(from); }
    if (to) { where.push('spent_at <= ?::date'); params.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT e.*, u.name AS recorded_by_name
       FROM production_expenses e
       LEFT JOIN users u ON u.id = e.recorded_by
       ${whereSql}
       ORDER BY e.spent_at DESC, e.id DESC LIMIT 500`,
      ...params,
    );
    const totalRow = await db.get(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM production_expenses ${whereSql}`,
      ...params,
    );
    res.json({ data: rows, total: totalRow?.total || 0 });
  }),
);

const expenseSchema = z.object({
  amount: z.number().nonnegative(),
  category: z.string().max(60).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  spent_at: z.string().optional(), // YYYY-MM-DD; если не передан — CURRENT_DATE
});

router.post(
  '/expenses',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const data = expenseSchema.parse(req.body || {});
    const r = await db.run(
      `INSERT INTO production_expenses (amount, category, description, spent_at, recorded_by)
       VALUES (?, ?, ?, COALESCE(?::date, CURRENT_DATE), ?) RETURNING id`,
      data.amount, data.category ?? null, data.description ?? null,
      data.spent_at ?? null, req.user.id,
    );
    const row = await db.get('SELECT * FROM production_expenses WHERE id = ?', r.lastInsertRowid);
    await logAction(req, { action: 'production_expense.created', entity_type: 'production_expense', entity_id: row.id, details: { amount: row.amount, category: row.category } });
    res.status(201).json(row);
  }),
);

router.patch(
  '/expenses/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const data = expenseSchema.partial().parse(req.body || {});
    const cur = await db.get('SELECT id FROM production_expenses WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Расход не найден');
    const updates = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'spent_at') {
        updates.push('spent_at = ?::date');
        params.push(v);
      } else {
        updates.push(`${k} = ?`);
        params.push(v ?? null);
      }
    }
    if (!updates.length) return res.json(await db.get('SELECT * FROM production_expenses WHERE id = ?', cur.id));
    params.push(cur.id);
    await db.run(`UPDATE production_expenses SET ${updates.join(', ')} WHERE id = ?`, ...params);
    await logAction(req, { action: 'production_expense.updated', entity_type: 'production_expense', entity_id: cur.id });
    res.json(await db.get('SELECT * FROM production_expenses WHERE id = ?', cur.id));
  }),
);

router.delete(
  '/expenses/:id',
  requireRole('admin', 'director_prod'),
  asyncHandler(async (req, res) => {
    const cur = await db.get('SELECT id FROM production_expenses WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Расход не найден');
    await db.run('DELETE FROM production_expenses WHERE id = ?', cur.id);
    await logAction(req, { action: 'production_expense.deleted', entity_type: 'production_expense', entity_id: cur.id });
    res.status(204).send();
  }),
);

export default router;
