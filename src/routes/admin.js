// Админские операции: бэкап БД, управление МС-интеграцией.
import { Router } from 'express';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import {
  msFetchStores, msFetchOrganizations, msFindCounterpartyByName,
} from '../services/moysklad.js';
import {
  getMoyskladToken, getMsConfig, setMsSetting,
  listMsJobs, retryMsJob, runPendingMsJobs, enqueueMsJob,
} from '../services/ms-jobs.js';

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

// =================== МойСклад: интеграция ===================

// Состояние конфига и очереди.
router.get(
  '/ms/status',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const token = await getMoyskladToken();
    const config = await getMsConfig();
    const counts = await db.all(
      `SELECT status, COUNT(*)::int AS n FROM ms_jobs GROUP BY status`,
    );
    res.json({
      has_token: !!token,
      ...config,
      job_counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  }),
);

// Разовая инициализация: тянем из МС список складов, контрагента «Розничный покупатель»
// (или указанного), и первую активную организацию. Сохраняем UUID-ы в app_settings.
router.post(
  '/ms/init',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const token = await getMoyskladToken();
    if (!token) throw BadRequest('Токен МойСклад не настроен — задайте его в разделе «Настройки».');
    const counterpartyName = (req.body?.counterparty_name || 'Розничный покупатель').trim();

    const [stores, orgs, counterparties] = await Promise.all([
      msFetchStores(token),
      msFetchOrganizations(token),
      msFindCounterpartyByName(token, counterpartyName),
    ]);

    if (!orgs.length) throw BadRequest('В МС не найдено ни одной активной организации.');
    if (!counterparties.length) {
      throw BadRequest(`В МС не найден контрагент с именем «${counterpartyName}». Создайте его в МС или передайте другое имя.`);
    }

    const storeMap = Object.fromEntries(stores.filter((s) => !s.archived).map((s) => [s.name, s.id]));
    const organizationId = orgs[0].id;
    const counterpartyId = counterparties[0].id;

    await Promise.all([
      setMsSetting('moysklad.store_map', storeMap),
      setMsSetting('moysklad.organization_id', organizationId),
      setMsSetting('moysklad.counterparty_id', counterpartyId),
      setMsSetting('moysklad.init_completed_at', new Date().toISOString()),
    ]);

    res.json({
      store_map: storeMap,
      organization: orgs[0],
      counterparty: counterparties[0],
      organizations_available: orgs,
    });
  }),
);

// Список задач очереди (фильтр по статусу).
router.get(
  '/ms/jobs',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const status = req.query.status || null;
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const offset = Number(req.query.offset) || 0;
    res.json(await listMsJobs({ status, limit, offset }));
  }),
);

// Повторить failed задачу.
router.post(
  '/ms/jobs/:id/retry',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.get('SELECT * FROM ms_jobs WHERE id = ?', id);
    if (!row) throw NotFound('Задача не найдена');
    await retryMsJob(id);
    res.json({ ok: true });
  }),
);

// Отменить действие в МС: ставит обратную задачу (только в МС, статус заказа в CRM
// не меняется). Например, для «Резерв» (reserve_mode=full) делаем «Снятие резерва»
// (reserve_mode=none). Полезно если админ сделал лишнее действие и хочет откатить
// эффект в МС, не меняя статус заказа в CRM.
router.post(
  '/ms/jobs/:id/undo',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.get('SELECT * FROM ms_jobs WHERE id = ?', id);
    if (!row) throw NotFound('Задача не найдена');
    if (row.status !== 'done') throw BadRequest('Отменить можно только успешно выполненную задачу (status=done)');

    if (row.action === 'customer_order.upsert') {
      const reverseMode = row.payload?.reserve_mode === 'full' ? 'none' : 'full';
      await enqueueMsJob(row.order_id, 'customer_order.upsert', {
        reserve_mode: reverseMode,
        undo_of: id,
      });
      res.json({ ok: true, reverse_mode: reverseMode });
    } else if (row.action === 'markdown.create') {
      // Откат уценки: удалить salesreturn, архивировать товары, вернуть заказ в pending.
      await enqueueMsJob(row.order_id, 'markdown.undo', { undo_of: id });
      res.json({ ok: true, undo_action: 'markdown.undo' });
    } else {
      throw BadRequest(`Отмена действия «${row.action}» пока не поддерживается`);
    }
  }),
);

// Принудительно прогнать очередь сейчас (для отладки).
router.post(
  '/ms/jobs/run-now',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const processed = await runPendingMsJobs(20);
    res.json({ processed });
  }),
);

// =================== Аудит-лог ===================

// Список записей с пагинацией и фильтрами. Только админ.
// Фильтры: entity_type, action (LIKE), user_id, from, to (created_at).
router.get(
  '/audit',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = [];
    const params = [];
    if (req.query.entity_type) {
      where.push('entity_type = ?');
      params.push(String(req.query.entity_type));
    }
    if (req.query.entity_id) {
      where.push('entity_id = ?');
      params.push(Number(req.query.entity_id));
    }
    if (req.query.action) {
      // LIKE по префиксу (например, action=order. отдаст все order.*)
      where.push('action LIKE ?');
      params.push(`${req.query.action}%`);
    }
    if (req.query.user_id) {
      where.push('user_id = ?');
      params.push(Number(req.query.user_id));
    }
    if (req.query.from) {
      where.push('created_at >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('created_at <= ?');
      params.push(String(req.query.to));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.all(
      `SELECT id, user_id, user_name, user_role, action, entity_type, entity_id,
              details, ip, created_at
       FROM audit_log ${whereSql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const total = await db.get(`SELECT COUNT(*)::int AS n FROM audit_log ${whereSql}`, ...params);
    res.json({ data: rows, total: total?.n || 0, limit, offset });
  }),
);

export default router;
