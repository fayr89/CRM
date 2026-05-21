import { Router } from 'express';
import { z } from 'zod';
import { authenticate, hashPassword, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'sales']).default('sales'),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'manager', 'sales']).optional(),
  password: z.string().min(6).optional(),
  active: z.boolean().optional(),
});

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const rows = await db.all(
      `SELECT id, email, name, role, active, created_at, updated_at
       FROM users ORDER BY id ASC LIMIT ? OFFSET ?`,
      limit,
      offset,
    );
    const { total } = await db.get('SELECT COUNT(*)::int AS total FROM users');
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await db.get(
      `SELECT id, email, name, role, active, created_at, updated_at
       FROM users WHERE id = ?`,
      req.params.id,
    );
    if (!user) throw NotFound('Пользователь не найден');
    res.json(user);
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const exists = await db.get('SELECT id FROM users WHERE email = ?', data.email);
    if (exists) throw BadRequest('Email уже существует');
    const result = await db.run(
      `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?) RETURNING id`,
      data.email,
      hashPassword(data.password),
      data.name,
      data.role,
    );
    const user = await db.get(
      `SELECT id, email, name, role, active, created_at FROM users WHERE id = ?`,
      result.lastInsertRowid,
    );
    res.status(201).json(user);
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const isSelf = req.user.id === id;
    const isAdmin = req.user.role === 'admin';
    if (!isSelf && !isAdmin) throw Forbidden();
    if (!isAdmin && (data.role || data.active !== undefined)) {
      throw Forbidden('Изменять роль и активность может только администратор');
    }
    const existing = await db.get('SELECT * FROM users WHERE id = ?', id);
    if (!existing) throw NotFound('Пользователь не найден');

    const updates = [];
    const params = [];
    if (data.email) {
      updates.push('email = ?');
      params.push(data.email);
    }
    if (data.name) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.role) {
      updates.push('role = ?');
      params.push(data.role);
    }
    if (data.password) {
      updates.push('password_hash = ?');
      params.push(hashPassword(data.password));
    }
    if (data.active !== undefined) {
      updates.push('active = ?');
      params.push(Boolean(data.active));
    }
    if (!updates.length) return res.json(existing);
    updates.push('updated_at = NOW()');
    params.push(id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
    const updated = await db.get(
      `SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE id = ?`,
      id,
    );
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw BadRequest('Нельзя удалить самого себя');
    const result = await db.run('DELETE FROM users WHERE id = ?', id);
    if (result.changes === 0) throw NotFound('Пользователь не найден');
    res.status(204).send();
  }),
);

export default router;
