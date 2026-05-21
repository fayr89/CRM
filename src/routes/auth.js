import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword, authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Unauthorized, asyncHandler } from '../errors.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const acceptSchema = z.object({
  token: z.string().min(8),
  name: z.string().min(1),
  password: z.string().min(6),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await db.get(
      'SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?',
      email,
    );
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      throw Unauthorized('Неверный email или пароль');
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }),
);

// Регистрация по приглашению. Открытая саморегистрация отключена.
router.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const { token, name, password } = acceptSchema.parse(req.body);
    const invite = await db.get(
      `SELECT * FROM invitations WHERE token = ?`,
      token,
    );
    if (!invite) throw BadRequest('Приглашение не найдено');
    if (invite.accepted_at) throw BadRequest('Приглашение уже использовано');
    if (new Date(invite.expires_at) < new Date()) throw BadRequest('Приглашение просрочено');

    const existing = await db.get('SELECT id FROM users WHERE email = ?', invite.email);
    if (existing) throw BadRequest('Пользователь с таким email уже существует');

    const userResult = await db.withTransaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO users (email, password_hash, name, role, manager_id)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        invite.email,
        hashPassword(password),
        name,
        invite.role,
        invite.manager_id,
      );
      await tx.run(
        `UPDATE invitations SET accepted_at = NOW(), accepted_user_id = ?
         WHERE id = ?`,
        r.lastInsertRowid,
        invite.id,
      );
      return r.lastInsertRowid;
    });

    const user = await db.get(
      'SELECT id, email, name, role FROM users WHERE id = ?',
      userResult,
    );
    const jwt = signToken(user);
    res.status(201).json({ token: jwt, user });
  }),
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
