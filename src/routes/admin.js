// Админские операции: бэкап БД (скачивание JSON-дампа).
import { Router } from 'express';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

// Таблицы для бэкапа. Порядок важен при восстановлении (родители раньше детей).
const BACKUP_TABLES = [
  'users',
  'companies',
  'contacts',
  'leads',
  'deals',
  'activities',
  'notes',
  'products',
  'product_prices',
  'orders',
  'order_items',
  'payments',
  'invitations',
  'api_tokens',
  'webhooks',
  'app_settings',
  'shipping_schedule',
];

// Полный дамп БД в JSON. Только админ. Включает хеши паролей — храните файл безопасно.
router.get(
  '/backup',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const dump = { version: 1, created_at: new Date().toISOString(), tables: {} };
    for (const table of BACKUP_TABLES) {
      try {
        dump.tables[table] = await db.all(`SELECT * FROM ${table}`);
      } catch {
        // таблицы может не быть — пропускаем
        dump.tables[table] = [];
      }
    }
    const filename = `crm-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(dump, null, 2));
  }),
);

export default router;
