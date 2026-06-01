import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword, authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, Unauthorized, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();

// Rate limiting для защиты от brute-force (простая in-memory реализация)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 минут

function checkRateLimit(ip) {
  const key = `login_${ip}`;
  const attempts = loginAttempts.get(key) || { count: 0, until: 0 };

  if (attempts.until > Date.now()) {
    throw Unauthorized(`Слишком много попыток входа. Подождите ${Math.ceil((attempts.until - Date.now()) / 1000)} сек`);
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    attempts.until = Date.now() + LOCKOUT_TIME;
    loginAttempts.set(key, attempts);
    throw Unauthorized(`Слишком много попыток. Заблокировано на 15 минут`);
  }

  return { key, attempts };
}

function recordLoginAttempt(key) {
  const attempts = loginAttempts.get(key) || { count: 0, until: 0 };
  attempts.count += 1;
  loginAttempts.set(key, attempts);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

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
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const { key, attempts } = checkRateLimit(ip);

    const { email, password } = loginSchema.parse(req.body);
    const user = await db.get(
      'SELECT id, email, name, role, password_hash, active FROM users WHERE email = ?',
      email,
    );
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      recordLoginAttempt(key);
      // Логируем неудачную попытку (без передачи req.user — его нет на этом этапе).
      // user_id = найденного пользователя, если есть; иначе null. Email — в details.
      await logAction(
        { headers: req.headers, ip, user: user ? { id: user.id, name: user.name, role: user.role } : null },
        { action: 'auth.login_failed', entity_type: 'user', entity_id: user?.id || null, details: { email, reason: !user ? 'no_user' : !user.active ? 'inactive' : 'bad_password' } },
      );
      throw Unauthorized('Неверный email или пароль');
    }

    clearLoginAttempts(key);
    // access_blocks — best-effort (колонка может ещё не существовать на этом соединении пула)
    let accessBlocks = null;
    try {
      const ab = await db.get('SELECT access_blocks FROM users WHERE id = ?', user.id);
      accessBlocks = ab?.access_blocks ?? null;
    } catch {
      // колонки нет — не критично
    }
    const token = signToken(user);
    await logAction(
      { headers: req.headers, ip, user: { id: user.id, name: user.name, role: user.role } },
      { action: 'auth.login', entity_type: 'user', entity_id: user.id },
    );
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, access_blocks: accessBlocks,
      },
    });
  }),
);

// Быстрый вход админа под любой ролью (имперсонация). role='admin' — вернуться к себе.
const IMPERSONATE_ROLES = ['manager', 'rop', 'warehouse', 'aus', 'sales', 'finance', 'admin'];
router.post(
  '/impersonate',
  authenticate,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user.role === 'admin' || req.user.realRole === 'admin';
    if (!isAdmin) throw Forbidden('Только администратор может менять роль для просмотра');
    const role = String(req.body?.role || '');
    if (!IMPERSONATE_ROLES.includes(role)) throw BadRequest('Недопустимая роль');
    const base = { id: req.user.id, email: req.user.email, role: 'admin' };
    const token = role === 'admin' ? signToken(base) : signToken(base, role);
    await logAction(req, { action: 'auth.impersonate', entity_type: 'user', entity_id: req.user.id, details: { role } });
    res.json({
      token,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role,
        impersonating: role !== 'admin',
      },
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

const changePasswordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(6, 'Новый пароль должен быть не короче 6 символов'),
});

router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { current, next } = changePasswordSchema.parse(req.body);
    const u = await db.get('SELECT id, password_hash FROM users WHERE id = ?', req.user.id);
    if (!u || !verifyPassword(current, u.password_hash)) {
      throw BadRequest('Неверный текущий пароль');
    }
    if (current === next) throw BadRequest('Новый пароль совпадает со старым');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
    await logAction(req, { action: 'user.password_changed', entity_type: 'user', entity_id: req.user.id, details: { self: true } });
    res.json({ ok: true });
  }),
);

export default router;
