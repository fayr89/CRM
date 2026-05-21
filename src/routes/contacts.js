import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'first_name', 'last_name', 'email', 'created_at', 'updated_at'];

const baseSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  company_id: z.number().int().positive().optional().nullable(),
  owner_id: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
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
        '(c.first_name ILIKE ? OR c.last_name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ?)',
      );
      const s = `%${req.query.search}%`;
      params.push(s, s, s, s);
    }
    if (req.query.company_id) {
      where.push('c.company_id = ?');
      params.push(Number(req.query.company_id));
    }
    if (req.query.owner_id) {
      where.push('c.owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT c.*, comp.name AS company_name
       FROM contacts c
       LEFT JOIN companies comp ON comp.id = c.company_id
       ${whereSql} ORDER BY c.${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM contacts c ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const contact = await db.get(
      `SELECT c.*, comp.name AS company_name
       FROM contacts c
       LEFT JOIN companies comp ON comp.id = c.company_id
       WHERE c.id = ?`,
      req.params.id,
    );
    if (!contact) throw NotFound('Контакт не найден');
    res.json(contact);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const result = await db.run(
      `INSERT INTO contacts
       (first_name, last_name, email, phone, position, company_id, owner_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.first_name,
      data.last_name ?? null,
      data.email || null,
      data.phone ?? null,
      data.position ?? null,
      data.company_id ?? null,
      data.owner_id ?? req.user.id,
      data.notes ?? null,
    );
    const created = await db.get('SELECT * FROM contacts WHERE id = ?', result.lastInsertRowid);
    res.status(201).json(created);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM contacts WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Контакт не найден');

    const updates = [];
    const params = [];
    for (const key of [
      'first_name',
      'last_name',
      'email',
      'phone',
      'position',
      'company_id',
      'owner_id',
      'notes',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM contacts WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM contacts WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Контакт не найден');
    res.status(204).send();
  }),
);

export default router;
