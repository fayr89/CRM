import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';
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
    const db = getDb();

    const where = [];
    const params = [];
    if (req.query.type) {
      where.push('type = ?');
      params.push(req.query.type);
    }
    if (req.query.owner_id) {
      where.push('owner_id = ?');
      params.push(Number(req.query.owner_id));
    }
    if (req.query.related_to_type) {
      where.push('related_to_type = ?');
      params.push(req.query.related_to_type);
    }
    if (req.query.related_to_id) {
      where.push('related_to_id = ?');
      params.push(Number(req.query.related_to_id));
    }
    if (req.query.status === 'completed') {
      where.push('completed_at IS NOT NULL');
    } else if (req.query.status === 'pending') {
      where.push('completed_at IS NULL');
    }
    if (req.query.upcoming === 'true') {
      where.push("completed_at IS NULL AND (due_date IS NULL OR due_date >= datetime('now'))");
    }
    if (req.query.overdue === 'true') {
      where.push("completed_at IS NULL AND due_date < datetime('now')");
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT * FROM activities ${whereSql} ORDER BY ${sort.column} ${sort.dir} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM activities ${whereSql}`)
      .get(...params);
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
    if (!activity) throw NotFound('Activity not found');
    res.json(activity);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO activities
         (type, subject, description, due_date, completed_at,
          related_to_type, related_to_id, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.type,
        data.subject,
        data.description ?? null,
        data.due_date ?? null,
        data.completed_at ?? null,
        data.related_to_type ?? null,
        data.related_to_id ?? null,
        data.owner_id ?? req.user.id,
      );
    res
      .status(201)
      .json(db.prepare('SELECT * FROM activities WHERE id = ?').get(result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Activity not found');

    const updates = [];
    const params = [];
    for (const key of [
      'type',
      'subject',
      'description',
      'due_date',
      'completed_at',
      'related_to_type',
      'related_to_id',
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
    db.prepare(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id));
  }),
);

router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE activities SET completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(req.params.id);
    if (result.changes === 0) throw NotFound('Activity not found');
    res.json(db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
    if (result.changes === 0) throw NotFound('Activity not found');
    res.status(204).send();
  }),
);

export default router;
