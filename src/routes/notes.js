import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();

const RELATED_TYPES = ['contact', 'company', 'lead', 'deal'];

const createSchema = z.object({
  content: z.string().min(1),
  related_to_type: z.enum(RELATED_TYPES),
  related_to_id: z.number().int().positive(),
});

const updateSchema = z.object({
  content: z.string().min(1),
});

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);

    const where = [];
    const params = [];
    if (req.query.related_to_type) {
      where.push('related_to_type = ?');
      params.push(req.query.related_to_type);
    }
    if (req.query.related_to_id) {
      where.push('related_to_id = ?');
      params.push(Number(req.query.related_to_id));
    }
    if (req.query.author_id) {
      where.push('author_id = ?');
      params.push(Number(req.query.author_id));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT n.*, u.name AS author_name FROM notes n
       LEFT JOIN users u ON u.id = n.author_id
       ${whereSql} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM notes ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const note = await db.get(
      `SELECT n.*, u.name AS author_name FROM notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.id = ?`,
      req.params.id,
    );
    if (!note) throw NotFound('Заметка не найдена');
    res.json(note);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const result = await db.run(
      `INSERT INTO notes (content, related_to_type, related_to_id, author_id)
       VALUES (?, ?, ?, ?) RETURNING id`,
      data.content,
      data.related_to_type,
      data.related_to_id,
      req.user.id,
    );
    res
      .status(201)
      .json(await db.get('SELECT * FROM notes WHERE id = ?', result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT * FROM notes WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Заметка не найдена');
    if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('Можно редактировать только свои заметки');
    }
    await db.run(`UPDATE notes SET content = ?, updated_at = NOW() WHERE id = ?`, data.content, req.params.id);
    res.json(await db.get('SELECT * FROM notes WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await db.get('SELECT * FROM notes WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Заметка не найдена');
    if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('Можно удалять только свои заметки');
    }
    await db.run('DELETE FROM notes WHERE id = ?', req.params.id);
    res.status(204).send();
  }),
);

export default router;
