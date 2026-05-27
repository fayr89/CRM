import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { Forbidden, Unauthorized } from './errors.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// actAs — роль для имперсонации (только админ может смотреть систему глазами другой роли).
export function signToken(user, actAs = null) {
  const payload = { sub: user.id, email: user.email, role: user.role };
  if (actAs) payload.act = actAs;
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(Unauthorized('Missing or invalid Authorization header'));
  }
  try {
    const payload = verifyToken(token);
    const user = await db.get(
      'SELECT id, email, name, role, active, access_blocks FROM users WHERE id = ?',
      payload.sub,
    );
    if (!user || !user.active) return next(Unauthorized('User not found or disabled'));
    // Имперсонация: только реальный админ может смотреть систему под другой ролью.
    if (payload.act && user.role === 'admin' && payload.act !== 'admin') {
      user.realRole = 'admin';
      user.role = payload.act;
      user.impersonating = true;
    }
    req.user = user;
    next();
  } catch (e) {
    next(Unauthorized('Invalid or expired token'));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(Unauthorized());
    if (!roles.includes(req.user.role)) return next(Forbidden('Insufficient role'));
    next();
  };
}
