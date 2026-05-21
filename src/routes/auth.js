import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword, authenticate } from '../auth.js';
import { getDb } from '../db.js';
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
    const db = getDb();
    const user = db
      .prepare('SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?')
      .get(email);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      throw Unauthorized('Invalid email or password');
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }),
);

// Open self-registration creates a 'sales' user. The first user (admin) is seeded
// from .env. Use /api/users (admin only) for role-specific user creation.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, name } = registerSchema.parse(req.body);
    const db = getDb();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) throw BadRequest('Email already registered');
    const result = db
      .prepare(
        `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'sales')`,
      )
      .run(email, hashPassword(password), name);
    const user = db
      .prepare('SELECT id, email, name, role FROM users WHERE id = ?')
      .get(result.lastInsertRowid);
    const token = signToken(user);
    res.status(201).json({ token, user });
  }),
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
