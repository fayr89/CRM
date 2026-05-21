import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';
import { generateToken, hashToken, tokenPrefix } from '../middleware/apiToken.js';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db.all(
      `SELECT t.id, t.name, t.token_prefix, t.scopes, t.last_used_at,
              t.revoked_at, t.created_at, u.name AS created_by_name
       FROM api_tokens t
       LEFT JOIN users u ON u.id = t.created_by
       ORDER BY t.id DESC`,
    );
    res.json({ data: rows });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  scopes: z.string().optional().default('leads:create,orders:create'),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const raw = generateToken();
    const r = await db.run(
      `INSERT INTO api_tokens (name, token_hash, token_prefix, scopes, created_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      data.name,
      hashToken(raw),
      tokenPrefix(raw),
      data.scopes,
      req.user.id,
    );
    const row = await db.get('SELECT * FROM api_tokens WHERE id = ?', r.lastInsertRowid);
    res.status(201).json({ ...row, token: raw });
  }),
);

router.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const r = await db.run(
      `UPDATE api_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`,
      req.params.id,
    );
    if (r.changes === 0) throw NotFound('Токен не найден или уже отозван');
    res.json({ ok: true });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const r = await db.run('DELETE FROM api_tokens WHERE id = ?', req.params.id);
    if (r.changes === 0) throw NotFound('Токен не найден');
    res.status(204).send();
  }),
);

export default router;
