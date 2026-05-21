import { Router } from 'express';
import { z } from 'zod';
import { canAccessOwner, ownerScopeClause } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, parseSort, paginated } from '../query.js';

const router = Router();

const SORT_COLUMNS = ['id', 'due_date', 'type', 'created_at', 'completed_at'];
const TYPES = ['call', 'email', 'meeting', 'task'];
const RELATED_TYPES = ['contact', 'company', 'lead', 'deal'];

const baseSchema = z.object({
  type: z.enum(TYPES),
  subject: z.string().min(1),
  description: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  completed_at: z.string().optional().nullable(),
  related_to_type: z.enum(RELATED_TYPES).optional().nullable(),
  related_to_id: z.number().int().positive().optional().nullable(),
  owner_id: z.number().int().positive().optional().nullable(),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_COLUMNS, 'due_date', 'ASC');

    const where = [];
    const params = [];
    if (req.query.type) { where.push('type = ?'); params.push(req.query.type); }
    if (req.query.owner_id) { where.push('owner_id = ?'); params.push(Number(req.query.owner_id)); }
    if (req.query.related_to_type) { where.push('related_to_type = ?'); params.push(req.query.related_to_type); }
    if (req.query.related_to_id) { where.push('related_to_id = ?'); params.push(Number(req.query.related_to_id)); }
    if (req.query.status === 'completed') where.push('completed_at IS NOT NULL');
    else if (req.query.status === 'pending') where.push('completed_at IS NULL');
    if (req.query.upcoming === 'true') where.push('completed_at IS NULL AND (due_date IS NULL OR due_date >= NOW())');
    if (req.query.overdue === 'true') where.push('completed_at IS NULL AND due_date < NOW()');

    const scope = await ownerScopeClause(req.user);
    if (scope.sql) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT * FROM activities ${whereSql} ORDER BY ${sort.column} ${sort.dir} NULLS LAST LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM activities ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const activity = await db.get('SELECT * FROM activities WHERE id = ?', req.params.id);
    if (!activity) throw NotFound('Задача не найдена');
    if (!(await canAccessOwner(req.user, activity.owner_id))) throw Forbidden();
    res.json(activity);
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
      `INSERT INTO activities
       (type, subject, description, due_date, completed_at,
        related_to_type, related_to_id, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.type, data.subject, data.description ?? null, data.due_date ?? null,
      data.completed_at ?? null, data.related_to_type ?? null, data.related_to_id ?? null,
      ownerId,
    );
    res.status(201).json(await db.get('SELECT * FROM activities WHERE id = ?', result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM activities WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Задача не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    if (data.owner_id !== undefined && !(await canAccessOwner(req.user, data.owner_id))) {
      throw Forbidden('Нет прав назначить этого пользователя ответственным');
    }

    const updates = [];
    const params = [];
    for (const key of [
      'type', 'subject', 'description', 'due_date', 'completed_at',
      'related_to_type', 'related_to_id', 'owner_id',
    ]) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json(await db.get('SELECT * FROM activities WHERE id = ?', req.params.id));
  }),
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM activities WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Задача не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run(
      `UPDATE activities SET completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      req.params.id,
    );
    res.json(await db.get('SELECT * FROM activities WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT owner_id FROM activities WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Задача не найдена');
    if (!(await canAccessOwner(req.user, existing.owner_id))) throw Forbidden();
    await db.run('DELETE FROM activities WHERE id = ?', req.params.id);
    res.status(204).send();
  }),
);

export default router;
