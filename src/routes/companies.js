import { Router } from 'express';
import { z } from 'zod';
import { canAccessOwner, ownerScopeClause } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'name', 'created_at', 'updated_at', 'annual_revenue'];

const baseSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional().nullable(),
  website: z.string().url().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  size: z.enum(['small', 'medium', 'large', 'enterprise']).optional().nullable(),
  annual_revenue: z.number().nonnegative().optional().nullable(),
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
      where.push('(name ILIKE ? OR email ILIKE ? OR website ILIKE ?)');
      const s = `%${req.query.search}%`;
      params.push(s, s, s);
    }
    if (req.query.owner_id) {
      where.push('owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    if (req.query.industry) {
      where.push('industry = ?');
      params.push(req.query.industry);
    }
    if (req.query.size) {
      where.push('size = ?');
      params.push(req.query.size);
    }
    const scope = await ownerScopeClause(req.user);
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT * FROM companies ${whereSql} ORDER BY ${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM companies ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const company = await db.get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!company) throw NotFound('Компания не найдена');
    if (!(await canAccessOwner(req.user, company.owner_id))) throw Forbidden();
    res.json(company);
  }),
);

router.get(
  '/:id/contacts',
  asyncHandler(async (req, res) => {
    const company = await db.get('SELECT owner_id FROM companies WHERE id = ?', req.params.id);
    if (!company) throw NotFound('Компания не найдена');
    if (!(await canAccessOwner(req.user, company.owner_id))) throw Forbidden();
    const rows = await db.all(
      'SELECT * FROM contacts WHERE company_id = ? ORDER BY id DESC',
      req.params.id,
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/:id/deals',
  asyncHandler(async (req, res) => {
    const company = await db.get('SELECT owner_id FROM companies WHERE id = ?', req.params.id);
    if (!company) throw NotFound('Компания не найдена');
    if (!(await canAccessOwner(req.user, company.owner_id))) throw Forbidden();
    const rows = await db.all(
      'SELECT * FROM deals WHERE company_id = ? ORDER BY id DESC',
      req.params.id,
    );
    res.json({ data: rows });
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
      `INSERT INTO companies
       (name, industry, website, phone, email, address, size, annual_revenue, description, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.name,
      data.industry ?? null,
      data.website || null,
      data.phone ?? null,
      data.email || null,
      data.address ?? null,
      data.size ?? null,
      data.annual_revenue ?? null,
      data.description ?? null,
      ownerId,
    );
    const created = await db.get('SELECT * FROM companies WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(created);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM companies WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Компания не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    if (data.owner_id !== undefined && !(await canAccessOwner(req.user, data.owner_id))) {
      throw Forbidden('Нет прав назначить этого пользователя ответственным');
    }

    const updates = [];
    const params = [];
    for (const key of [
      'name', 'industry', 'website', 'phone', 'email', 'address',
      'size', 'annual_revenue', 'description', 'owner_id',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM companies WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM companies WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Компания не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run('DELETE FROM companies WHERE id = ?', req.params.id);
    res.status(204).send();
  }),
);

export default router;
