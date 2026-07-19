// Модуль «Поставки → Доставки» (ТЗ 18.07.2026) — ТЕСТОВАЯ ЗОНА.
//
// Phase 1 = только изоляция: фиче-флаг + гейтинг + скелет. Реальные сущности
// (Поставка/Доставка, интеграции WB/Ozon/ЯМ) — следующие фазы, добавляются
// ПОД этот гейт, чтобы не мешать боевому потоку. Всё инертно, пока владелец
// не включит флаг для конкретных тест-аккаунтов (см. services/featureFlags.js).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import {
  getSupplyDeliveryConfig, setSupplyDeliveryConfig,
  canSeeSupplyDelivery, canOperateSupplyDelivery,
} from '../services/featureFlags.js';
import {
  ensureSupplyDeliverySchema, getWarehouseReward, setWarehouseReward,
  getLaborRatePerMin, setLaborRatePerMin, computeDeliveryFinance,
} from '../services/supplyDeliverySchema.js';
import { encryptSecret, decryptSecret } from '../services/secrets.js';
import { fetchWbCards } from '../services/channelApis.js';

const router = Router();
router.use(authenticate);

// Статус зоны для текущего пользователя — фронт по нему решает, показывать ли
// пункт меню. Доступен всем авторизованным (возвращает visible=false, если нельзя).
router.get(
  '/flag',
  asyncHandler(async (req, res) => {
    const cfg = await getSupplyDeliveryConfig();
    res.json({
      visible: canSeeSupplyDelivery(req.user, cfg),
      can_operate: canOperateSupplyDelivery(req.user, cfg),
      enabled: cfg.enabled,
      is_admin: req.user.role === 'admin',
    });
  }),
);

// Настройки тест-зоны (только админ): вкл/выкл + кому дать тестовый доступ.
router.get(
  '/settings',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const cfg = await getSupplyDeliveryConfig();
    // Кандидаты в тест-пользователи — активные не-админы (админ и так видит зону).
    const users = await db.all(
      `SELECT id, name, email, role FROM users
       WHERE active IS NOT FALSE AND role <> 'admin'
       ORDER BY name`,
    );
    res.json({ ...cfg, users });
  }),
);

const settingsSchema = z.object({
  enabled: z.boolean(),
  test_user_ids: z.array(z.number().int().positive()).max(200).optional().default([]),
});

router.put(
  '/settings',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = settingsSchema.parse(req.body);
    const saved = await setSupplyDeliveryConfig(data, req.user.id);
    await logAction(req, {
      action: 'feature.supply_delivery.settings',
      entity_type: 'feature_flag',
      entity_id: 0,
      details: saved,
    });
    res.json(saved);
  }),
);

// Гейт для «рабочих» эндпоинтов зоны — инертен, пока флаг выключен.
async function requireOperate(req, res, next) {
  try {
    const cfg = await getSupplyDeliveryConfig();
    if (!canOperateSupplyDelivery(req.user, cfg)) {
      return next(Forbidden('Тестовая зона «Поставки/Доставки» выключена или у вас нет доступа'));
    }
    return next();
  } catch (e) {
    return next(e);
  }
}

// Скелет модуля (Phase 1). Заглушка, чтобы фронт показал структуру и подтвердил,
// что гейтинг работает. Реальные данные — в следующих фазах.
router.get(
  '/overview',
  requireOperate,
  asyncHandler(async (_req, res) => {
    res.json({
      status: 'skeleton',
      phase: 1,
      message: 'Тестовая зона активна. Модуль в разработке — сущности появятся поэтапно.',
      sections: [
        { key: 'supplies', title: 'Поставки', status: 'planned' },
        { key: 'deliveries', title: 'Доставки', status: 'planned' },
        { key: 'directories', title: 'Справочники (тарифы, вознаграждение, пороги, mapping)', status: 'planned' },
        { key: 'reports', title: 'Отчёты по доставкам', status: 'planned' },
      ],
    });
  }),
);

// ==================== Phase 2a: Справочники офиса ====================
// Все под requireOperate — инертны, пока тест-зона выключена.

// ----- Тарифы упаковки (тип + единица измерения + стоимость; с историей цены) -----
const tariffSchema = z.object({
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(30),
  cost: z.number().nonnegative(),
});

router.get('/packaging-tariffs', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all('SELECT * FROM sd_packaging_tariffs WHERE active = TRUE ORDER BY name'));
}));

router.post('/packaging-tariffs', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = tariffSchema.parse(req.body);
  const row = await db.get(
    'INSERT INTO sd_packaging_tariffs (name, unit, cost, time_norm_min) VALUES (?, ?, ?, 0) RETURNING *',
    d.name, d.unit, d.cost,
  );
  await db.run(
    'INSERT INTO sd_packaging_tariff_history (tariff_id, cost, time_norm_min, changed_by) VALUES (?, ?, 0, ?)',
    row.id, d.cost, req.user.id,
  );
  res.json(row);
}));

router.put('/packaging-tariffs/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = tariffSchema.parse(req.body);
  const cur = await db.get('SELECT * FROM sd_packaging_tariffs WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Тариф не найден');
  const row = await db.get(
    'UPDATE sd_packaging_tariffs SET name = ?, unit = ?, cost = ?, updated_at = NOW() WHERE id = ? RETURNING *',
    d.name, d.unit, d.cost, req.params.id,
  );
  // История цены — только при реальном изменении стоимости (старые доставки не
  // пересчитываются: снапшот тарифа берётся в момент добавления в доставку).
  if (Number(cur.cost) !== d.cost) {
    await db.run(
      'INSERT INTO sd_packaging_tariff_history (tariff_id, cost, time_norm_min, changed_by) VALUES (?, ?, 0, ?)',
      req.params.id, d.cost, req.user.id,
    );
  }
  res.json(row);
}));

// ----- Каналы + юрлица + API-ключи (только админ) -----
const channelAccountSchema = z.object({
  channel: z.enum(['wb', 'ozon', 'ym', 'avito']),
  legal_entity: z.string().max(200).optional().nullable(),
  api_key: z.string().max(4000).optional().nullable(),
  manager_id: z.number().int().positive().optional().nullable(),
});

function maskKey(enc) {
  if (!enc) return null;
  try {
    const plain = decryptSecret(enc);
    if (!plain) return null;
    const tail = plain.slice(-4);
    return `••••${tail}`;
  } catch { return '••••'; }
}

router.get('/channel-accounts', requireRole('admin'), asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  const accounts = await db.all(
    `SELECT a.id, a.channel, a.legal_entity, a.manager_id, a.active, a.api_key_enc, u.name AS manager_name
     FROM sd_channel_accounts a LEFT JOIN users u ON u.id = a.manager_id
     ORDER BY a.channel, a.id`,
  );
  const users = await db.all(
    "SELECT id, name, email, role FROM users WHERE active IS NOT FALSE AND role <> 'admin' ORDER BY name",
  );
  res.json({
    accounts: accounts.map((a) => ({
      id: a.id, channel: a.channel, legal_entity: a.legal_entity,
      manager_id: a.manager_id, manager_name: a.manager_name, active: a.active,
      key_set: !!a.api_key_enc, key_mask: maskKey(a.api_key_enc),
    })),
    users,
  });
}));

router.post('/channel-accounts', requireRole('admin'), asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = channelAccountSchema.parse(req.body);
  const enc = d.api_key ? encryptSecret(d.api_key.trim()) : null;
  const row = await db.get(
    `INSERT INTO sd_channel_accounts (channel, legal_entity, api_key_enc, manager_id)
     VALUES (?, ?, ?, ?) RETURNING id`,
    d.channel, d.legal_entity ?? null, enc, d.manager_id ?? null,
  );
  await logAction(req, { action: 'supply_delivery.channel_account.create', entity_type: 'sd_channel_account', entity_id: row.id, details: { channel: d.channel } });
  res.json({ ok: true, id: row.id });
}));

router.put('/channel-accounts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = channelAccountSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const cur = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Канал не найден');
  // Ключ обновляем только если прислали непустой (иначе не трогаем сохранённый).
  const enc = (d.api_key && d.api_key.trim()) ? encryptSecret(d.api_key.trim()) : cur.api_key_enc;
  await db.run(
    `UPDATE sd_channel_accounts SET
       channel = COALESCE(?, channel), legal_entity = COALESCE(?, legal_entity),
       api_key_enc = ?, manager_id = COALESCE(?, manager_id),
       active = COALESCE(?, active), updated_at = NOW()
     WHERE id = ?`,
    d.channel ?? null, d.legal_entity ?? null, enc, d.manager_id ?? null,
    d.active ?? null, req.params.id,
  );
  res.json({ ok: true });
}));

router.delete('/channel-accounts/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_channel_accounts WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.delete('/packaging-tariffs/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('UPDATE sd_packaging_tariffs SET active = FALSE, updated_at = NOW() WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.get('/packaging-tariffs/:id/history', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    'SELECT * FROM sd_packaging_tariff_history WHERE tariff_id = ? ORDER BY changed_at DESC',
    req.params.id,
  ));
}));

// ----- Вознаграждение склада -----
const rewardSchema = z.object({
  amount: z.number().nonnegative(),
  unit: z.enum(['per_order', 'per_item', 'per_hour']),
});

router.get('/reward', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await getWarehouseReward());
}));

router.put('/reward', requireOperate, asyncHandler(async (req, res) => {
  const d = rewardSchema.parse(req.body);
  res.json(await setWarehouseReward(d, req.user.id));
}));

// ----- Пороги остатков при поставке (глобальный 'default' + по SKU) -----
const thresholdSchema = z.object({
  threshold: z.number().int().nonnegative(),
  mode: z.enum(['warn', 'block']),
});

router.get('/thresholds', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    "SELECT * FROM sd_stock_thresholds ORDER BY (sku = 'default') DESC, sku",
  ));
}));

router.put('/thresholds/:sku', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = thresholdSchema.parse(req.body);
  const sku = String(req.params.sku).trim();
  if (!sku) throw BadRequest('Пустой SKU');
  const row = await db.get(
    `INSERT INTO sd_stock_thresholds (sku, threshold, mode, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON CONFLICT (sku) DO UPDATE SET threshold = EXCLUDED.threshold, mode = EXCLUDED.mode,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    sku, d.threshold, d.mode, req.user.id,
  );
  res.json(row);
}));

router.delete('/thresholds/:sku', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  if (req.params.sku === 'default') throw BadRequest('Глобальный порог нельзя удалить — только изменить');
  await db.run('DELETE FROM sd_stock_thresholds WHERE sku = ?', req.params.sku);
  res.json({ ok: true });
}));

// ==================== Phase 2b: Поставки / Доставки ====================

// ----- Финансовые параметры (ставка труда + вознаграждение) -----
router.get('/finance-settings', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json({
    labor_rate_per_min: await getLaborRatePerMin(),
    reward: await getWarehouseReward(),
  });
}));

router.put('/finance-settings', requireOperate, asyncHandler(async (req, res) => {
  const rate = z.object({ labor_rate_per_min: z.number().nonnegative() }).parse(req.body);
  const saved = await setLaborRatePerMin(rate.labor_rate_per_min, req.user.id);
  res.json({ labor_rate_per_min: saved });
}));

// ----- Поставки -----
const supplySchema = z.object({
  channel: z.enum(['wb', 'ozon', 'ym', 'avito']),
  model: z.enum(['fbs', 'fbo']),
  legal_entity: z.string().max(200).optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

router.get('/supplies', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    `SELECT s.*, COALESCE(i.cnt, 0) AS item_count, COALESCE(i.qty, 0) AS total_qty
     FROM sd_supplies s
     LEFT JOIN (SELECT supply_id, COUNT(*) AS cnt, SUM(quantity) AS qty FROM sd_supply_items GROUP BY supply_id) i
       ON i.supply_id = s.id
     ORDER BY s.id DESC`,
  ));
}));

router.post('/supplies', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = supplySchema.parse(req.body);
  const row = await db.get(
    `INSERT INTO sd_supplies (channel, model, legal_entity, title, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    d.channel, d.model, d.legal_entity ?? null, d.title ?? null, d.note ?? null, req.user.id,
  );
  res.json(row);
}));

router.get('/supplies/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const supply = await db.get('SELECT * FROM sd_supplies WHERE id = ?', req.params.id);
  if (!supply) throw NotFound('Поставка не найдена');
  const items = await db.all('SELECT * FROM sd_supply_items WHERE supply_id = ? ORDER BY id', req.params.id);
  res.json({ ...supply, items });
}));

router.put('/supplies/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = supplySchema.partial().extend({
    status: z.enum(['draft', 'in_work', 'shipped']).optional(),
  }).parse(req.body);
  const cur = await db.get('SELECT * FROM sd_supplies WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Поставка не найдена');
  const row = await db.get(
    `UPDATE sd_supplies SET
       channel = COALESCE(?, channel), model = COALESCE(?, model),
       legal_entity = COALESCE(?, legal_entity), title = COALESCE(?, title),
       note = COALESCE(?, note), status = COALESCE(?, status), updated_at = NOW()
     WHERE id = ? RETURNING *`,
    d.channel ?? null, d.model ?? null, d.legal_entity ?? null, d.title ?? null,
    d.note ?? null, d.status ?? null, req.params.id,
  );
  res.json(row);
}));

router.delete('/supplies/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_supplies WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

const itemSchema = z.object({
  sku: z.string().max(120).optional().nullable(),
  name: z.string().max(300).optional().nullable(),
  quantity: z.number().int().positive(),
  product_id: z.number().int().positive().optional().nullable(),
});

router.post('/supplies/:id/items', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const supply = await db.get('SELECT id FROM sd_supplies WHERE id = ?', req.params.id);
  if (!supply) throw NotFound('Поставка не найдена');
  const d = itemSchema.parse(req.body);
  const row = await db.get(
    `INSERT INTO sd_supply_items (supply_id, sku, name, quantity, product_id)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    req.params.id, d.sku ?? null, d.name ?? null, d.quantity, d.product_id ?? null,
  );
  res.json(row);
}));

router.delete('/supplies/:id/items/:itemId', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_supply_items WHERE id = ? AND supply_id = ?', req.params.itemId, req.params.id);
  res.json({ ok: true });
}));

// ----- Доставки -----
async function loadDeliveryDetail(id) {
  const delivery = await db.get('SELECT * FROM sd_deliveries WHERE id = ?', id);
  if (!delivery) return null;
  const supplies = await db.all(
    `SELECT s.*, COALESCE(i.qty, 0) AS total_qty
     FROM sd_delivery_supplies ds
     JOIN sd_supplies s ON s.id = ds.supply_id
     LEFT JOIN (SELECT supply_id, SUM(quantity) AS qty FROM sd_supply_items GROUP BY supply_id) i ON i.supply_id = s.id
     WHERE ds.delivery_id = ? ORDER BY s.id`,
    id,
  );
  const itemStats = {
    supply_count: supplies.length,
    total_qty: supplies.reduce((s, x) => s + (Number(x.total_qty) || 0), 0),
  };
  // Упаковка и зарплата ДЕРИВАЮТСЯ из позиций доставки × продуктовый справочник:
  //   упаковка = Σ (расход упаковки × кол-во × цена ед. тарифа)
  //   время    = Σ (время упаковки позиции × кол-во)  → зарплата = время × ставка ₽/мин
  // Позиция сопоставляется с внутренним товаром по product_id, иначе по sku
  // (LATERAL LIMIT 1 — без размножения строк на неуникальных sku).
  const agg = await db.get(
    `SELECT
       COALESCE(SUM(pd.packaging_consumption * i.quantity * COALESCE(t.cost, 0)), 0) AS packaging_cost,
       COALESCE(SUM(pd.packing_time_min * i.quantity), 0) AS labor_minutes,
       COUNT(*) FILTER (WHERE pd.product_id IS NULL) AS positions_unmapped,
       COUNT(*) AS positions_total
     FROM sd_delivery_supplies ds
     JOIN sd_supply_items i ON i.supply_id = ds.supply_id
     LEFT JOIN LATERAL (
       SELECT pr.id FROM products pr
       WHERE (i.product_id IS NOT NULL AND pr.id = i.product_id)
          OR (i.product_id IS NULL AND i.sku IS NOT NULL AND pr.sku = i.sku)
       ORDER BY pr.id LIMIT 1
     ) p ON TRUE
     LEFT JOIN sd_product_directory pd ON pd.product_id = p.id
     LEFT JOIN sd_packaging_tariffs t ON t.id = pd.packaging_tariff_id
     WHERE ds.delivery_id = ?`,
    id,
  );
  const finance = computeDeliveryFinance({
    delivery,
    packagingCost: agg?.packaging_cost || 0,
    laborMinutes: agg?.labor_minutes || 0,
    laborRatePerMin: await getLaborRatePerMin(),
    reward: await getWarehouseReward(),
    itemStats,
  });
  finance.positions_unmapped = Number(agg?.positions_unmapped) || 0;
  finance.positions_total = Number(agg?.positions_total) || 0;
  return { ...delivery, supplies, item_stats: itemStats, finance };
}

router.get('/deliveries', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    `SELECT d.*, COALESCE(ds.cnt, 0) AS supply_count
     FROM sd_deliveries d
     LEFT JOIN (SELECT delivery_id, COUNT(*) AS cnt FROM sd_delivery_supplies GROUP BY delivery_id) ds
       ON ds.delivery_id = d.id
     ORDER BY d.id DESC`,
  ));
}));

router.post('/deliveries', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = z.object({
    title: z.string().max(200).optional().nullable(),
    logistics_cost: z.number().nonnegative().optional().default(0),
  }).parse(req.body);
  const row = await db.get(
    'INSERT INTO sd_deliveries (title, logistics_cost, created_by) VALUES (?, ?, ?) RETURNING *',
    d.title ?? null, d.logistics_cost ?? 0, req.user.id,
  );
  res.json(row);
}));

router.get('/deliveries/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const detail = await loadDeliveryDetail(req.params.id);
  if (!detail) throw NotFound('Доставка не найдена');
  res.json(detail);
}));

router.put('/deliveries/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = z.object({
    title: z.string().max(200).optional().nullable(),
    logistics_cost: z.number().nonnegative().optional(),
    status: z.enum(['draft', 'closed']).optional(),
  }).parse(req.body);
  const cur = await db.get('SELECT * FROM sd_deliveries WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Доставка не найдена');
  const closedAt = d.status === 'closed' ? 'NOW()' : (d.status === 'draft' ? 'NULL' : 'closed_at');
  await db.run(
    `UPDATE sd_deliveries SET
       title = COALESCE(?, title),
       logistics_cost = COALESCE(?, logistics_cost),
       status = COALESCE(?, status),
       closed_at = ${closedAt},
       updated_at = NOW()
     WHERE id = ?`,
    d.title ?? null, d.logistics_cost ?? null, d.status ?? null, req.params.id,
  );
  res.json(await loadDeliveryDetail(req.params.id));
}));

router.delete('/deliveries/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_deliveries WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.post('/deliveries/:id/supplies', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { supply_id } = z.object({ supply_id: z.number().int().positive() }).parse(req.body);
  const supply = await db.get('SELECT id FROM sd_supplies WHERE id = ?', supply_id);
  if (!supply) throw NotFound('Поставка не найдена');
  await db.run(
    `INSERT INTO sd_delivery_supplies (delivery_id, supply_id) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
    req.params.id, supply_id,
  );
  res.json(await loadDeliveryDetail(req.params.id));
}));

router.delete('/deliveries/:id/supplies/:supplyId', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_delivery_supplies WHERE delivery_id = ? AND supply_id = ?', req.params.id, req.params.supplyId);
  res.json(await loadDeliveryDetail(req.params.id));
}));

router.post('/deliveries/:id/packaging', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = z.object({
    tariff_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
  }).parse(req.body);
  const t = await db.get('SELECT * FROM sd_packaging_tariffs WHERE id = ?', d.tariff_id);
  if (!t) throw NotFound('Тариф упаковки не найден');
  // Снапшот тарифа — доставка не пересчитывается при будущем изменении справочника.
  await db.run(
    `INSERT INTO sd_delivery_packaging (delivery_id, tariff_id, tariff_name, unit_cost, unit_time_min, quantity)
     VALUES (?, ?, ?, ?, ?, ?)`,
    req.params.id, t.id, t.name, t.cost, t.time_norm_min, d.quantity,
  );
  res.json(await loadDeliveryDetail(req.params.id));
}));

router.delete('/deliveries/:id/packaging/:lineId', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_delivery_packaging WHERE id = ? AND delivery_id = ?', req.params.lineId, req.params.id);
  res.json(await loadDeliveryDetail(req.params.id));
}));

// ----- Продуктовый справочник (номенклатура МойСклада) -----
router.get('/product-directory', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const search = (req.query.search || '').toString().trim();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const params = [];
  let where = "p.external_source = 'moysklad' AND p.active = TRUE AND p.is_markdown IS NOT TRUE";
  if (search) {
    where += ' AND (p.sku ILIKE ? OR p.name ILIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const rows = await db.all(
    `SELECT p.id AS product_id, p.sku, p.name,
            d.packaging_tariff_id, d.packaging_consumption, d.packing_time_min,
            d.dim_l, d.dim_w, d.dim_h,
            t.name AS packaging_name, t.unit AS packaging_unit
     FROM products p
     LEFT JOIN sd_product_directory d ON d.product_id = p.id
     LEFT JOIN sd_packaging_tariffs t ON t.id = d.packaging_tariff_id
     WHERE ${where}
     ORDER BY p.name LIMIT ?`,
    ...params, limit,
  );
  res.json(rows);
}));

const productDirSchema = z.object({
  packaging_tariff_id: z.number().int().positive().optional().nullable(),
  packaging_consumption: z.number().nonnegative().optional().default(0),
  packing_time_min: z.number().nonnegative().optional().default(0),
  dim_l: z.number().nonnegative().optional().nullable(),
  dim_w: z.number().nonnegative().optional().nullable(),
  dim_h: z.number().nonnegative().optional().nullable(),
});

router.put('/product-directory/:productId', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = productDirSchema.parse(req.body);
  const prod = await db.get('SELECT id FROM products WHERE id = ?', req.params.productId);
  if (!prod) throw NotFound('Товар не найден');
  const row = await db.get(
    `INSERT INTO sd_product_directory
       (product_id, packaging_tariff_id, packaging_consumption, packing_time_min, dim_l, dim_w, dim_h, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (product_id) DO UPDATE SET
       packaging_tariff_id = EXCLUDED.packaging_tariff_id,
       packaging_consumption = EXCLUDED.packaging_consumption,
       packing_time_min = EXCLUDED.packing_time_min,
       dim_l = EXCLUDED.dim_l, dim_w = EXCLUDED.dim_w, dim_h = EXCLUDED.dim_h,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    req.params.productId, d.packaging_tariff_id ?? null, d.packaging_consumption ?? 0, d.packing_time_min ?? 0,
    d.dim_l ?? null, d.dim_w ?? null, d.dim_h ?? null, req.user.id,
  );
  res.json(row);
}));

// ----- Matching номенклатуры канала ⇄ внутренней (Phase 3, WB первый) -----
router.get('/channel-map', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const channel = (req.query.channel || 'wb').toString();
  const status = (req.query.status || 'all').toString();
  const search = (req.query.search || '').toString().trim();
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const params = [channel];
  let where = 'm.channel = ?';
  if (status === 'matched') where += ' AND m.product_id IS NOT NULL';
  else if (status === 'unmatched') where += ' AND m.product_id IS NULL';
  if (search) {
    where += ' AND (m.channel_barcode ILIKE ? OR m.channel_sku ILIKE ? OR m.channel_name ILIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const rows = await db.all(
    `SELECT m.*, p.sku AS product_sku, p.name AS product_name
     FROM sd_product_channel_map m
     LEFT JOIN products p ON p.id = m.product_id
     WHERE ${where}
     ORDER BY (m.product_id IS NULL) DESC, m.id DESC
     LIMIT ?`,
    ...params, limit,
  );
  const counts = await db.get(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE product_id IS NOT NULL) AS matched
     FROM sd_product_channel_map WHERE channel = ?`,
    channel,
  );
  res.json({ rows, total: Number(counts?.total) || 0, matched: Number(counts?.matched) || 0 });
}));

router.post('/channel-map/import', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = z.object({
    channel: z.enum(['wb', 'ozon', 'ym', 'avito']),
    items: z.array(z.object({
      barcode: z.string().max(120).optional().nullable(),
      sku: z.string().max(120).optional().nullable(),
      name: z.string().max(400).optional().nullable(),
    })).max(5000),
  }).parse(req.body);
  let n = 0;
  for (const it of d.items) {
    if (!it.barcode && !it.sku) continue;
    await db.run(
      `INSERT INTO sd_product_channel_map (channel, channel_barcode, channel_sku, channel_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (channel, COALESCE(channel_barcode, ''), COALESCE(channel_sku, ''))
       DO UPDATE SET channel_name = EXCLUDED.channel_name, updated_at = NOW()`,
      d.channel, it.barcode ?? null, it.sku ?? null, it.name ?? null,
    );
    n += 1;
  }
  res.json({ ok: true, imported: n });
}));

// Подтяжка номенклатуры WB через API (ключ берётся из справочника «Каналы»).
router.post('/channel-map/pull-wb', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel_account_id } = z.object({ channel_account_id: z.number().int().positive() }).parse(req.body);
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', channel_account_id, 'wb');
  if (!acc) throw BadRequest('Не найден WB-канал с ключом. Заведите его в справочнике «Каналы».');
  if (!acc.api_key_enc) throw BadRequest('У этого канала не задан API-ключ');
  const key = decryptSecret(acc.api_key_enc);
  let items;
  try { items = await fetchWbCards(key, { limit: 1000 }); }
  catch (e) { throw BadRequest(e.message); }
  let n = 0;
  for (const it of items) {
    if (!it.channel_barcode && !it.channel_sku) continue;
    await db.run(
      `INSERT INTO sd_product_channel_map (channel, channel_barcode, channel_sku, channel_name, channel_extra)
       VALUES ('wb', ?, ?, ?, ?::jsonb)
       ON CONFLICT (channel, COALESCE(channel_barcode, ''), COALESCE(channel_sku, ''))
       DO UPDATE SET channel_name = EXCLUDED.channel_name, channel_extra = EXCLUDED.channel_extra, updated_at = NOW()`,
      it.channel_barcode ?? null, it.channel_sku ?? null, it.channel_name ?? null,
      JSON.stringify(it.channel_extra || {}),
    );
    n += 1;
  }
  res.json({ ok: true, pulled: n });
}));

// Авто-сопоставление: артикул канала (channel_sku) = внутренний артикул (products.sku).
router.post('/channel-map/auto-match', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel } = z.object({ channel: z.enum(['wb', 'ozon', 'ym', 'avito']) }).parse(req.body);
  const r = await db.run(
    `UPDATE sd_product_channel_map m
     SET product_id = p.id, matched_at = NOW(), updated_at = NOW()
     FROM products p
     WHERE m.channel = ? AND m.product_id IS NULL
       AND m.channel_sku IS NOT NULL AND p.sku = m.channel_sku
       AND p.external_source = 'moysklad'`,
    channel,
  );
  res.json({ ok: true, matched: r.changes || 0 });
}));

router.put('/channel-map/:id/match', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { product_id } = z.object({ product_id: z.number().int().positive() }).parse(req.body);
  const prod = await db.get('SELECT id FROM products WHERE id = ?', product_id);
  if (!prod) throw NotFound('Товар не найден');
  await db.run('UPDATE sd_product_channel_map SET product_id = ?, matched_at = NOW(), updated_at = NOW() WHERE id = ?', product_id, req.params.id);
  res.json({ ok: true });
}));

router.put('/channel-map/:id/unmatch', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('UPDATE sd_product_channel_map SET product_id = NULL, matched_at = NULL, updated_at = NOW() WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.delete('/channel-map/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_product_channel_map WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

export default router;
