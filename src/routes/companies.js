import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';
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
    const db = getDb();

    const where = [];
    const params = [];
    if (req.query.search) {
      where.push('(name LIKE ? OR email LIKE ? OR website LIKE ?)');
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT * FROM companies ${whereSql} ORDER BY ${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM companies ${whereSql}`)
      .get(...params);
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    if (!company) throw NotFound('Company not found');
    res.json(company);
  }),
);

router.get(
  '/:id/contacts',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY id DESC')
      .all(req.params.id);
    res.json({ data: rows });
  }),
);

router.get(
  '/:id/deals',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM deals WHERE company_id = ? ORDER BY id DESC')
      .all(req.params.id);
    res.json({ data: rows });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO companies
         (name, industry, website, phone, email, address, size, annual_revenue, description, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.industry ?? null,
        data.website || null,
        data.phone ?? null,
        data.email || null,
        data.address ?? null,
        data.size ?? null,
        data.annual_revenue ?? null,
        data.description ?? null,
        data.owner_id ?? req.user.id,
      );
    const created = db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Company not found');

    const updates = [];
    const params = [];
    for (const key of [
      'name',
      'industry',
      'website',
      'phone',
      'email',
      'address',
      'size',
      'annual_revenue',
      'description',
      'owner_id',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
    if (result.changes === 0) throw NotFound('Company not found');
    res.status(204).send();
  }),
);

export default router;
