import { Router } from 'express';
import { z } from 'zod';
import { authenticate, hashPassword, requireRole } from '../auth.js';
import { getDb } from '../db.js';
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
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, email, name, role, active, created_at, updated_at
         FROM users ORDER BY id ASC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM users').get();
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, email, name, role, active, created_at, updated_at
         FROM users WHERE id = ?`,
      )
      .get(req.params.id);
    if (!user) throw NotFound('User not found');
    res.json(user);
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
    if (exists) throw BadRequest('Email already exists');
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)`,
      )
      .run(data.email, hashPassword(data.password), data.name, data.role);
    const user = db
      .prepare(
        `SELECT id, email, name, role, active, created_at FROM users WHERE id = ?`,
      )
      .get(result.lastInsertRowid);
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
    // Only admin can change role / active
    if (!isAdmin && (data.role || data.active !== undefined)) {
      throw Forbidden('Only admins can change role or active flag');
    }
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw NotFound('User not found');

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
      params.push(data.active ? 1 : 0);
    }
    if (!updates.length) return res.json(existing);
    updates.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db
      .prepare(
        `SELECT id, email, name, role, active, created_at, updated_at FROM users WHERE id = ?`,
      )
      .get(id);
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw BadRequest('Cannot delete yourself');
    const db = getDb();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) throw NotFound('User not found');
    res.status(204).send();
  }),
);

export default router;
