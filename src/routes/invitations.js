import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { canAccessUser } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { parsePagination, paginated } from '../query.js';

const router = Router();

const DEFAULT_TTL_DAYS = 7;

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional().nullable(),
  role: z.enum(['admin', 'manager', 'sales', 'warehouse', 'rop', 'aus', 'finance']).default('manager'),
  manager_id: z.number().int().positive().optional().nullable(),
  ttl_days: z.number().int().min(1).max(90).optional(),
});

// Публичный эндпоинт — проверка приглашения по токену (для UI принятия).
router.get(
  '/by-token/:token',
  asyncHandler(async (req, res) => {
    const invite = await db.get(
      `SELECT id, email, name, role, expires_at, accepted_at FROM invitations WHERE token = ?`,
      req.params.token,
    );
    if (!invite) throw NotFound('Приглашение не найдено');
    res.json(invite);
  }),
);

router.use(authenticate);

// Список приглашений: admin видит все, manager — только созданные им.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!['admin', 'rop'].includes(req.user.role)) throw Forbidden();
    const { page, limit, offset } = parsePagination(req.query);

    const where = [];
    const params = [];
    if (req.user.role !== 'admin') {
      where.push('invited_by = ?');
      params.push(req.user.id);
    }
    if (req.query.status === 'pending') {
      where.push('accepted_at IS NULL AND expires_at > NOW()');
    } else if (req.query.status === 'accepted') {
      where.push('accepted_at IS NOT NULL');
    } else if (req.query.status === 'expired') {
      where.push('accepted_at IS NULL AND expires_at <= NOW()');
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT i.*, u.name AS inviter_name, m.name AS manager_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN users m ON m.id = i.manager_id
       ${whereSql} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const { total } = await db.get(
      `SELECT COUNT(*)::int AS total FROM invitations i ${whereSql}`,
      ...params,
    );
    res.json(paginated(rows, total, page, limit));
  }),
);

// Создание приглашения (admin / manager)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!['admin', 'rop'].includes(req.user.role)) {
      throw Forbidden('Приглашать могут только админ или менеджер');
    }
    const data = createSchema.parse(req.body);

    let role = data.role;
    let managerId = data.manager_id ?? null;

    if (req.user.role === 'rop') {
      if (!['manager', 'sales'].includes(role)) {
        throw Forbidden('РОП может приглашать только менеджеров');
      }
      managerId = req.user.id;
    }

    // Не приглашать на уже занятый email
    const userExists = await db.get('SELECT id FROM users WHERE email = ?', data.email);
    if (userExists) throw BadRequest('Пользователь с таким email уже существует');

    // Аннулировать активные приглашения на тот же email
    await db.run(
      `UPDATE invitations SET expires_at = NOW()
       WHERE email = ? AND accepted_at IS NULL AND expires_at > NOW()`,
      data.email,
    );

    const token = crypto.randomBytes(24).toString('hex');
    const ttl = data.ttl_days ?? DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttl * 24 * 3600 * 1000).toISOString();

    const result = await db.run(
      `INSERT INTO invitations (token, email, name, role, manager_id, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      token,
      data.email,
      data.name ?? null,
      role,
      managerId,
      req.user.id,
      expiresAt,
    );
    const invite = await db.get(
      `SELECT i.*, m.name AS manager_name FROM invitations i
       LEFT JOIN users m ON m.id = i.manager_id WHERE i.id = ?`,
      result.lastInsertRowid,
    );
    res.status(201).json(invite);
  }),
);

// Удалить (отозвать) приглашение
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inv = await db.get('SELECT * FROM invitations WHERE id = ?', id);
    if (!inv) throw NotFound('Приглашение не найдено');
    if (req.user.role !== 'admin' && inv.invited_by !== req.user.id) {
      throw Forbidden('Можно отзывать только свои приглашения');
    }
    await db.run('DELETE FROM invitations WHERE id = ?', id);
    res.status(204).send();
  }),
);

export default router;
