import { Router } from 'express';
import { z } from 'zod';
import { canAccessOwner, ownerScopeClause } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'title', 'amount', 'stage', 'expected_close_date', 'created_at', 'updated_at'];
const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const OPEN_STAGES = ['new', 'qualified', 'proposal', 'negotiation'];

const baseSchema = z.object({
  title: z.string().min(1),
  amount: z.number().nonnegative().optional().default(0),
  currency: z.string().length(3).optional().default('USD'),
  stage: z.enum(STAGES).optional().default('new'),
  probability: z.number().int().min(0).max(100).optional(),
  expected_close_date: z.string().optional().nullable(),
  contact_id: z.number().int().positive().optional().nullable(),
  company_id: z.number().int().positive().optional().nullable(),
  owner_id: z.number().int().positive().optional().nullable(),
  description: z.string().optional().nullable(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

const STAGE_DEFAULT_PROBABILITY = {
  new: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0,
};

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'created_at', 'DESC');

    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(d.title ILIKE ? OR d.description ILIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s);
    }
    if (req.query.stage) {
      where.push('d.stage = ?');
      params.push(req.query.stage);
    }
    if (req.query.open === 'true') {
      where.push(`d.stage IN ('${OPEN_STAGES.join("','")}')`);
    }
    if (req.query.owner_id) {
      where.push('d.owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    if (req.query.company_id) {
      where.push('d.company_id = ?');
      params.push(Number(req.query.company_id));
    }
    if (req.query.contact_id) {
      where.push('d.contact_id = ?');
      params.push(Number(req.query.contact_id));
    }
    const scope = await ownerScopeClause(req.user, 'd.owner_id');
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT d.*, comp.name AS company_name,
              (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name
       FROM deals d
       LEFT JOIN companies comp ON comp.id = d.company_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       ${whereSql} ORDER BY d.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM deals d ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/pipeline',
  asyncHandler(async (req, res) => {
    const params = [];
    const where = [];
    if (req.query.owner_id) {
      where.push('owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    const scope = await ownerScopeClause(req.user);
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT stage, COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS total_amount,
              COALESCE(SUM(amount * probability / 100.0), 0)::float AS weighted_amount
       FROM deals ${whereSql}
       GROUP BY stage`,
      ...params,
    );
    const byStage = Object.fromEntries(
      STAGES.map((s) => [s, { stage: s, count: 0, total_amount: 0, weighted_amount: 0 }]),
    );
    for (const r of rows) byStage[r.stage] = r;
    res.json({
      stages: STAGES.map((s) => byStage[s]),
      pipeline_value: rows
        .filter((r) => OPEN_STAGES.includes(r.stage))
        .reduce((acc, r) => acc + Number(r.total_amount), 0),
      weighted_pipeline_value: rows
        .filter((r) => OPEN_STAGES.includes(r.stage))
        .reduce((acc, r) => acc + Number(r.weighted_amount), 0),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const deal = await db.get(
      `SELECT d.*, comp.name AS company_name,
              (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name
       FROM deals d
       LEFT JOIN companies comp ON comp.id = d.company_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE d.id = ?`,
      req.params.id,
    );
    if (!deal) throw NotFound('Сделка не найдена');
    if (!(await canAccessOwner(req.user, deal.owner_id))) throw Forbidden();
    res.json(deal);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const ownerId = data.owner_id ?? req.user.id;
    if (!(await canAccessOwner(req.user, ownerId))) {
      throw Forbidden('Нет прав назначить этого пользователя ответственным');
    }
    const probability = data.probability ?? STAGE_DEFAULT_PROBABILITY[data.stage];
    const result = await db.run(
      `INSERT INTO deals
       (title, amount, currency, stage, probability, expected_close_date,
        contact_id, company_id, owner_id, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.title, data.amount ?? 0, data.currency ?? 'USD', data.stage, probability,
      data.expected_close_date ?? null, data.contact_id ?? null, data.company_id ?? null,
      ownerId, data.description ?? null,
    );
    res.status(201).json(await db.get('SELECT * FROM deals WHERE id = ?', result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM deals WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Сделка не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    if (data.owner_id !== undefined && !(await canAccessOwner(req.user, data.owner_id))) {
      throw Forbidden('Нет прав назначить этого пользователя ответственным');
    }

    const updates = [];
    const params = [];
    for (const key of [
      'title', 'amount', 'currency', 'stage', 'probability', 'expected_close_date',
      'contact_id', 'company_id', 'owner_id', 'description',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (data.stage && ['won', 'lost'].includes(data.stage) && !existing.closed_at) {
      updates.push('closed_at = NOW()');
    }
    if (data.stage && !['won', 'lost'].includes(data.stage) && existing.closed_at) {
      updates.push('closed_at = NULL');
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE deals SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM deals WHERE id = ?', req.params.id));
  }),
);

router.post(
  '/:id/win',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM deals WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Сделка не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run(
      `UPDATE deals SET stage = 'won', probability = 100,
       closed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      req.params.id,
    );
    res.json(await db.get('SELECT * FROM deals WHERE id = ?', req.params.id));
  }),
);

router.post(
  '/:id/lose',
  asyncHandler(async (req, res) => {
    const reason = z.object({ reason: z.string().optional() }).parse(req.body || {}).reason;
    const existing = await db.get('SELECT owner_id FROM deals WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Сделка не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run(
      `UPDATE deals SET stage = 'lost', probability = 0, lost_reason = ?,
       closed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      reason ?? null, req.params.id,
    );
    res.json(await db.get('SELECT * FROM deals WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM deals WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Сделка не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run('DELETE FROM deals WHERE id = ?', req.params.id);
    res.status(204).send();
  }),
);

export default router;
