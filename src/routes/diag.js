// TEMP: создать склад в МойСклад. Сносится после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { msCreate, msFetchStores } from '../services/moysklad.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();
const SECRET = '4f8c9e2b5a1d6e3f8c9e2b5a1d6e3f8c';

async function getToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

router.get(
  '/create-store',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const msToken = await getToken();
    if (!msToken) return res.status(503).json({ error: 'MC token not configured' });
    // Проверим, нет ли уже такого имени.
    const existing = await msFetchStores(msToken);
    const dup = existing.rows?.find((s) => s.name === name);
    if (dup) {
      return res.json({ existed: true, id: dup.id, name: dup.name });
    }
    try {
      const created = await msCreate(msToken, 'store', { name });
      res.json({ created: true, id: created.id, name: created.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }),
);

export default router;
