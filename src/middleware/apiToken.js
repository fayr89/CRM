import crypto from 'node:crypto';
import { db } from '../db.js';
import { Forbidden, Unauthorized } from '../errors.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `crm_${raw}`;
}

export function tokenPrefix(token) {
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function extractToken(req) {
  if (req.headers['x-api-token']) return String(req.headers['x-api-token']).trim();
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Token ')) return auth.slice(6).trim();
  if (auth.startsWith('Bearer crm_')) return auth.slice(7).trim();
  return null;
}

export async function requireApiToken(req, _res, next) {
  const raw = extractToken(req);
  if (!raw) return next(Unauthorized('Передайте токен в заголовке X-API-Token'));
  const row = await db.get(
    `SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL`,
    hashToken(raw),
  );
  if (!row) return next(Unauthorized('Токен недействителен или отозван'));
  await db.run(`UPDATE api_tokens SET last_used_at = NOW() WHERE id = ?`, row.id);
  req.apiToken = row;
  next();
}

export function requireScope(scope) {
  return (req, _res, next) => {
    if (!req.apiToken) return next(Unauthorized());
    const scopes = (req.apiToken.scopes || '').split(',').map((s) => s.trim());
    if (!scopes.includes(scope) && !scopes.includes('*')) {
      return next(Forbidden(`Токену не разрешено действие ${scope}`));
    }
    next();
  };
}
