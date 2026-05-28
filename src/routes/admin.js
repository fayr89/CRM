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

// Чувствительные колонки, которые НЕ должны попадать в JSON-бэкап (даже у админа):
// — хеши паролей дают возможность брутфорса оффлайн
// — токены/секреты дают доступ от имени системы
const SENSITIVE_COLUMNS = {
  users: ['password_hash'],
  invitations: ['token'],
  api_tokens: ['token_hash'],
  webhooks: ['secret'],
};

// Полный дамп БД в JSON. Только админ. Чувствительные поля вырезаются (см. выше).
router.get(
  '/backup',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const dump = { version: 1, created_at: new Date().toISOString(), tables: {} };
    for (const table of BACKUP_TABLES) {
      try {
        const rows = await db.all(`SELECT * FROM ${table}`);
        const drop = SENSITIVE_COLUMNS[table];
        if (drop && rows.length) {
          for (const row of rows) for (const c of drop) delete row[c];
        }
        dump.tables[table] = rows;
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
