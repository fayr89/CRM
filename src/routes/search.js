import { Router } from 'express';
import { authenticate } from '../auth.js';
import { getAccessibleUserIds } from '../access.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ leads: [], contacts: [], companies: [], deals: [], orders: [] });
    }
    const like = `%${q}%`;
    const scope = await getAccessibleUserIds(req.user);
    const ownerFilter = scope === null ? null : scope;
    const limit = 8;

    function buildSql(table, fields, ownerCol) {
      const fieldSql = fields.map((f) => `${f} ILIKE ?`).join(' OR ');
      let sql = `SELECT * FROM ${table} WHERE (${fieldSql})`;
      const params = fields.map(() => like);
      if (ownerFilter && ownerCol) {
        sql += ` AND ${ownerCol} = ANY(?)`;
        params.push(ownerFilter);
      }
      sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
      return { sql, params };
    }

    const queries = [
      ['leads', buildSql('leads', ['first_name', 'last_name', 'email', 'phone', 'company_name'], 'owner_id')],
      ['contacts', buildSql('contacts', ['first_name', 'last_name', 'email', 'phone'], 'owner_id')],
      ['companies', buildSql('companies', ['name', 'email', 'phone', 'industry'], 'owner_id')],
      ['deals', buildSql('deals', ['title', 'description'], 'owner_id')],
      ['orders', buildSql('orders', ['reference_number', 'client_name', 'notes'], 'manager_id')],
    ];

    const out = {};
    for (const [key, { sql, params }] of queries) {
      out[key] = await db.all(sql, ...params);
    }
    res.json(out);
  }),
);

export default router;
