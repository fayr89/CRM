import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
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
    const db = getDb();

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

    const rows = db
      .prepare(
        `SELECT n.*, u.name AS author_name FROM notes n
         LEFT JOIN users u ON u.id = n.author_id
         ${whereSql} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM notes ${whereSql}`)
      .get(...params);
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const note = db
      .prepare(
        `SELECT n.*, u.name AS author_name FROM notes n
         LEFT JOIN users u ON u.id = n.author_id
         WHERE n.id = ?`,
      )
      .get(req.params.id);
    if (!note) throw NotFound('Note not found');
    res.json(note);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO notes (content, related_to_type, related_to_id, author_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(data.content, data.related_to_type, data.related_to_id, req.user.id);
    res
      .status(201)
      .json(db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Note not found');
    if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('You can only edit your own notes');
    }
    db.prepare(
      `UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(data.content, req.params.id);
    res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!existing) throw NotFound('Note not found');
    if (existing.author_id !== req.user.id && req.user.role !== 'admin') {
      throw Forbidden('You can only delete your own notes');
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    res.status(204).send();
  }),
);

export default router;
