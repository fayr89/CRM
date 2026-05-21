import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser, getAccessibleUserIds } from '../access.js';
import { authenticate, hashPassword, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();

// При создании от admin можно любую роль и любого менеджера.
// При создании от manager: роль принудительно 'sales', manager_id = self.
const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  role: z.enum(['admin', 'manager', 'sales', 'warehouse']).default('sales'),
  manager_id: z.number().int().positive().optional().nullable(),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'manager', 'sales', 'warehouse']).optional(),
  manager_id: z.number().int().positive().nullable().optional(),
  password: z.string().min(6).optional(),
  active: z.boolean().optional(),
});

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const ids = await getAccessibleUserIds(req.user);
    const scopeSql = ids === null ? '' : 'WHERE id = ANY(?)';
    const scopeParams = ids === null ? [] : [ids];
    const rows = await db.all(
      `SELECT id, email, name, role, active, manager_id, created_at, updated_at
       FROM users ${scopeSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
      ...scopeParams,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM users ${scopeSql}`,
      ...scopeParams,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await canAccessUser(req.user, id))) throw Forbidden('Нет доступа к этому пользователю');
    const user = await db.get(
      `SELECT id, email, name, role, active, manager_id, created_at, updated_at
       FROM users WHERE id = ?`,
      id,
    );
    if (!user) throw NotFound('Пользователь не найден');
    res.json(user);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const exists = await db.get('SELECT id FROM users WHERE email = ?', data.email);
    if (exists) throw BadRequest('Email уже существует');

    let role = data.role;
    let managerId = data.manager_id ?? null;

    if (!['admin', 'manager'].includes(req.user.role)) {
      throw Forbidden('Создавать пользователей могут только админ или менеджер');
    }
    if (req.user.role === 'manager') {
      // Менеджер может создавать только sales-подчинённого под собой
      if (role !== 'sales') {
        throw Forbidden('Менеджер может создавать только пользователей с ролью «sales»');
      }
      managerId = req.user.id;
    }
    if (req.user.role === 'admin' && managerId != null) {
      const mgr = await db.get('SELECT id FROM users WHERE id = ?', managerId);
      if (!mgr) throw BadRequest('Указанный менеджер не найден');
    }

    const result = await db.run(
      `INSERT INTO users (email, password_hash, name, role, manager_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      data.email,
      hashPassword(data.password),
      data.name,
      role,
      managerId,
    );
    const user = await db.get(
      `SELECT id, email, name, role, active, manager_id, created_at FROM users WHERE id = ?`,
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

    const existing = await db.get('SELECT * FROM users WHERE id = ?', id);
    if (!existing) throw NotFound('Пользователь не найден');

    // Менеджер может править своих подчинённых (но не себя или других)
    let isManagerOfTarget = false;
    if (req.user.role === 'manager' && !isSelf) {
      isManagerOfTarget = await canAccessUser(req.user, id);
    }

    if (!isAdmin && !isSelf && !isManagerOfTarget) {
      throw Forbidden('Нет прав на редактирование этого пользователя');
    }
    if (!isAdmin && (data.role || data.manager_id !== undefined || data.active !== undefined)) {
      throw Forbidden('Менять роль, менеджера и активность может только админ');
    }

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
    if (data.manager_id !== undefined) {
      if (data.manager_id === id) throw BadRequest('Пользователь не может быть менеджером сам себе');
      updates.push('manager_id = ?');
      params.push(data.manager_id);
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
      `SELECT id, email, name, role, active, manager_id, created_at, updated_at FROM users WHERE id = ?`,
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
