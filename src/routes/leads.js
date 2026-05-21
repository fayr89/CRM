import { Router } from 'express';
import { z } from 'zod';
import { canAccessOwner, ownerScopeClause } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'first_name', 'status', 'estimated_value', 'created_at', 'updated_at'];

const SOURCES = ['website', 'referral', 'cold_call', 'social', 'event', 'advertisement', 'other'];
const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];

const baseSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  source: z.enum(SOURCES).optional().nullable(),
  status: z.enum(STATUSES).optional(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  description: z.string().optional().nullable(),
  owner_id: z.number().int().positive().optional().nullable(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'created_at', 'DESC');

    const where = [];
    const params = [];
    if (req.query.search) {
      where.push(
        '(first_name ILIKE ? OR last_name ILIKE ? OR email ILIKE ? OR company_name ILIKE ?)',
      );
      const s = `%${req.query.search}%`;
      params.push(s, s, s, s);
    }
    if (req.query.status) {
      where.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.source) {
      where.push('source = ?');
      params.push(req.query.source);
    }
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
      `SELECT * FROM leads ${whereSql} ORDER BY ${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM leads ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await db.get('SELECT * FROM leads WHERE id = ?', req.params.id);
    if (!lead) throw NotFound('Лид не найден');
    if (!(await canAccessOwner(req.user, lead.owner_id))) throw Forbidden();
    res.json(lead);
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
    const result = await db.run(
      `INSERT INTO leads
       (first_name, last_name, email, phone, company_name, position, source, status,
        estimated_value, description, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.first_name,
      data.last_name ?? null,
      data.email || null,
      data.phone ?? null,
      data.company_name ?? null,
      data.position ?? null,
      data.source ?? null,
      data.status ?? 'new',
      data.estimated_value ?? null,
      data.description ?? null,
      ownerId,
    );
    res.status(201).json(await db.get('SELECT * FROM leads WHERE id = ?', result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM leads WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Лид не найден');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    if (data.owner_id !== undefined && !(await canAccessOwner(req.user, data.owner_id))) {
      throw Forbidden('Нет прав назначить этого пользователя ответственным');
    }

    const updates = [];
    const params = [];
    for (const key of [
      'first_name', 'last_name', 'email', 'phone', 'company_name', 'position',
      'source', 'status', 'estimated_value', 'description', 'owner_id',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM leads WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM leads WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Лид не найден');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run('DELETE FROM leads WHERE id = ?', req.params.id);
    res.status(204).send();
  }),
);

const convertSchema = z.object({
  create_deal: z.boolean().optional().default(true),
  deal_title: z.string().optional(),
  deal_amount: z.number().nonnegative().optional(),
  deal_stage: z.enum(['new', 'qualified', 'proposal', 'negotiation']).optional().default('qualified'),
  create_company: z.boolean().optional().default(true),
});

router.post(
  '/:id/convert',
  asyncHandler(async (req, res) => {
    const opts = convertSchema.parse(req.body || {});
    const lead = await db.get('SELECT * FROM leads WHERE id = ?', req.params.id);
    if (!lead) throw NotFound('Лид не найден');
    if (!(await canAccessOwner(req.user, lead.owner_id))) throw Forbidden();
    if (lead.status === 'converted') throw BadRequest('Лид уже сконвертирован');

    const result = await db.withTransaction(async (tx) => {
      let companyId = null;
      if (opts.create_company && lead.company_name) {
        const r = await tx.run(
          `INSERT INTO companies (name, owner_id) VALUES (?, ?) RETURNING id`,
          lead.company_name,
          lead.owner_id ?? req.user.id,
        );
        companyId = r.lastInsertRowid;
      }
      const contactR = await tx.run(
        `INSERT INTO contacts (first_name, last_name, email, phone, position, company_id, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        lead.first_name, lead.last_name, lead.email, lead.phone, lead.position,
        companyId, lead.owner_id ?? req.user.id,
      );
      const contactId = contactR.lastInsertRowid;

      let dealId = null;
      if (opts.create_deal) {
        const title =
          opts.deal_title ||
          `${lead.first_name}${lead.last_name ? ' ' + lead.last_name : ''} - ${
            lead.company_name || 'Новая сделка'
          }`;
        const dealR = await tx.run(
          `INSERT INTO deals (title, amount, stage, contact_id, company_id, owner_id)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
          title, opts.deal_amount ?? lead.estimated_value ?? 0, opts.deal_stage,
          contactId, companyId, lead.owner_id ?? req.user.id,
        );
        dealId = dealR.lastInsertRowid;
      }

      await tx.run(
        `UPDATE leads SET status = 'converted', converted_contact_id = ?, converted_deal_id = ?,
         converted_at = NOW(), updated_at = NOW() WHERE id = ?`,
        contactId, dealId, lead.id,
      );

      return { contactId, dealId, companyId };
    });

    res.json({
      lead: await db.get('SELECT * FROM leads WHERE id = ?', lead.id),
      contact: await db.get('SELECT * FROM contacts WHERE id = ?', result.contactId),
      deal: result.dealId ? await db.get('SELECT * FROM deals WHERE id = ?', result.dealId) : null,
      company: result.companyId
        ? await db.get('SELECT * FROM companies WHERE id = ?', result.companyId)
        : null,
    });
  }),
);

export default router;
