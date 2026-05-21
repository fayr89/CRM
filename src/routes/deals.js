import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
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
  new: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'created_at', 'DESC');
    const db = getDb();

    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(d.title LIKE ? OR d.description LIKE ?)');
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT d.*, comp.name AS company_name,
                (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name
         FROM deals d
         LEFT JOIN companies comp ON comp.id = d.company_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         ${whereSql} ORDER BY d.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM deals d ${whereSql}`)
      .get(...params);
    res.json(paginated(rows, total, page, limit));
  }),
);

// Sales pipeline grouped by stage.
router.get(
  '/pipeline',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ownerFilter = req.query.owner_id
      ? `WHERE owner_id = ${Number(req.query.owner_id)}`
      : '';
    const rows = db
      .prepare(
        `SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amount,
                COALESCE(SUM(amount * probability / 100.0), 0) AS weighted_amount
         FROM deals ${ownerFilter}
         GROUP BY stage`,
      )
      .all();
    const byStage = Object.fromEntries(
      STAGES.map((s) => [s, { stage: s, count: 0, total_amount: 0, weighted_amount: 0 }]),
    );
    for (const r of rows) byStage[r.stage] = r;
    res.json({
      stages: STAGES.map((s) => byStage[s]),
      pipeline_value: rows
        .filter((r) => OPEN_STAGES.includes(r.stage))
        .reduce((acc, r) => acc + r.total_amount, 0),
      weighted_pipeline_value: rows
        .filter((r) => OPEN_STAGES.includes(r.stage))
        .reduce((acc, r) => acc + r.weighted_amount, 0),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const deal = db
      .prepare(
        `SELECT d.*, comp.name AS company_name,
                (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name
         FROM deals d
         LEFT JOIN companies comp ON comp.id = d.company_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         WHERE d.id = ?`,
      )
      .get(req.params.id);
    if (!deal) throw NotFound('Deal not found');
    res.json(deal);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const probability = data.probability ?? STAGE_DEFAULT_PROBABILITY[data.stage];
    const result = db
      .prepare(
        `INSERT INTO deals
         (title, amount, currency, stage, probability, expected_close_date,
          contact_id, company_id, owner_id, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.title,
        data.amount ?? 0,
        data.currency ?? 'USD',
        data.stage,
        probability,
        data.expected_close_date ?? null,
        data.contact_id ?? null,
        data.company_id ?? null,
        data.owner_id ?? req.user.id,
        data.description ?? null,
      );
    res
      .status(201)
      .json(db.prepare('SELECT * FROM deals WHERE id = ?').get(result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Deal not found');

    const updates = [];
    const params = [];
    for (const key of [
      'title',
      'amount',
      'currency',
      'stage',
      'probability',
      'expected_close_date',
      'contact_id',
      'company_id',
      'owner_id',
      'description',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    // Auto-update closed_at when stage transitions to won/lost
    if (data.stage && ['won', 'lost'].includes(data.stage) && !existing.closed_at) {
      updates.push("closed_at = datetime('now')");
    }
    if (data.stage && !['won', 'lost'].includes(data.stage) && existing.closed_at) {
      updates.push('closed_at = NULL');
    }
    if (!updates.length) return res.json(existing);
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE deals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id));
  }),
);

router.post(
  '/:id/win',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE deals SET stage = 'won', probability = 100,
         closed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(req.params.id);
    if (result.changes === 0) throw NotFound('Deal not found');
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id));
  }),
);

router.post(
  '/:id/lose',
  asyncHandler(async (req, res) => {
    const reason = z.object({ reason: z.string().optional() }).parse(req.body || {}).reason;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Deal not found');
    db.prepare(
      `UPDATE deals SET stage = 'lost', probability = 0, lost_reason = ?,
       closed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(reason ?? null, req.params.id);
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
    if (result.changes === 0) throw NotFound('Deal not found');
    res.status(204).send();
  }),
);

export default router;
