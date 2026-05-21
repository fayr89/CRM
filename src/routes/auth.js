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

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
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

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, name } = registerSchema.parse(req.body);
    const exists = await db.get('SELECT id FROM users WHERE email = ?', email);
    if (exists) throw BadRequest('Email уже зарегистрирован');
    const result = await db.run(
      `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'sales') RETURNING id`,
      email,
      hashPassword(password),
      name,
    );
    const user = await db.get(
      'SELECT id, email, name, role FROM users WHERE id = ?',
      result.lastInsertRowid,
    );
    const token = signToken(user);
    res.status(201).json({ token, user });
  }),
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
