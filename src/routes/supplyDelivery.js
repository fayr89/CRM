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
import {
  fetchWbCards, fetchOzonCards, fetchYmCards,
  wbNewOrders, wbCreateSupply, wbAddOrderToSupply,
  wbSupplyBarcode, wbDeliverSupply, wbReshipmentOrders,
  wbFboListWarehouses, wbFboAcceptanceCoefficients,
} from '../services/channelApis.js';
import { fetchMoyskladBundlesPage, resolveMsFolderHref, pushMoyskladBundle } from '../services/moysklad.js';
import { getMoyskladToken } from '../services/ms-jobs.js';

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
  channel_account_id: z.number().int().positive().optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

// Ключ WB для поставки: из привязанного канал-аккаунта (справочник «Каналы»).
async function wbKeyForSupply(supply) {
  if (!supply.channel_account_id) throw BadRequest('У поставки не выбран WB-канал (с ключом). Укажите его при создании.');
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ?', supply.channel_account_id);
  if (!acc || !acc.api_key_enc) throw BadRequest('У выбранного канала нет API-ключа');
  return decryptSecret(acc.api_key_enc);
}

router.get('/supplies', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  // Юрлицо: сначала из поставки, если пусто — из привязанного канал-аккаунта.
  // Сумма поставки: Σ (quantity × price_из_прайса) по каналу поставки; sku позиции
  // → products.sku → product_prices по marketplace (label по SD channel). Если
  // цены нет — позиция вносит 0.
  res.json(await db.all(
    `SELECT s.*,
            COALESCE(s.legal_entity, a.legal_entity) AS legal_entity,
            COALESCE(i.cnt, 0) AS item_count,
            COALESCE(i.qty, 0) AS total_qty,
            COALESCE(amt.total_amount, 0) AS total_amount
     FROM sd_supplies s
     LEFT JOIN sd_channel_accounts a ON a.id = s.channel_account_id
     LEFT JOIN (SELECT supply_id, COUNT(*) AS cnt, SUM(quantity) AS qty FROM sd_supply_items GROUP BY supply_id) i
       ON i.supply_id = s.id
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(it.quantity * pp.price), 0) AS total_amount
       FROM sd_supply_items it
       JOIN products p ON p.sku = it.sku
       JOIN product_prices pp ON pp.product_id = p.id AND pp.marketplace = (
         CASE s.channel
           WHEN 'wb' THEN 'Wildberries'
           WHEN 'ozon' THEN 'Ozon'
           WHEN 'ym' THEN 'Яндекс.Маркет'
           WHEN 'avito' THEN 'Avito'
           ELSE '' END)
       WHERE it.supply_id = s.id
     ) amt ON TRUE
     ORDER BY s.id DESC`,
  ));
}));

router.post('/supplies', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = supplySchema.parse(req.body);
  const row = await db.get(
    `INSERT INTO sd_supplies (channel, model, legal_entity, channel_account_id, title, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    d.channel, d.model, d.legal_entity ?? null, d.channel_account_id ?? null, d.title ?? null, d.note ?? null, req.user.id,
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
       legal_entity = COALESCE(?, legal_entity), channel_account_id = COALESCE(?, channel_account_id),
       title = COALESCE(?, title), note = COALESCE(?, note), status = COALESCE(?, status), updated_at = NOW()
     WHERE id = ? RETURNING *`,
    d.channel ?? null, d.model ?? null, d.legal_entity ?? null, d.channel_account_id ?? null, d.title ?? null,
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
  // Упаковка и зарплата ДЕРИВАЮТСЯ из позиций доставки через «сет»:
  //   позиция (канал-SKU/штрихкод) → sd_product_channel_map (по каналу поставки)
  //   → sd_sets. Упаковка сета = Σ по строкам sd_set_packaging (несколько типов:
  //   плёнка + коробка + …) = Σ (расход × цена тарифа); итого × кол-во позиции.
  //   Время = Σ (время сета × кол-во) → зарплата = время × ставка ₽/мин.
  const agg = await db.get(
    `SELECT
       COALESCE(SUM(i.quantity * (
         SELECT COALESCE(SUM(sp.consumption * COALESCE(pt.cost, 0)), 0)
         FROM sd_set_packaging sp
         LEFT JOIN sd_packaging_tariffs pt ON pt.id = sp.packaging_tariff_id
         WHERE sp.set_id = st.id
       )), 0) AS packaging_cost,
       COALESCE(SUM(st.packing_time_min * i.quantity), 0) AS labor_minutes,
       COALESCE(SUM(COALESCE(st.warehouse_reward, 0) * i.quantity), 0) AS reward_total,
       COUNT(*) FILTER (WHERE st.id IS NULL) AS positions_unmapped,
       COUNT(*) AS positions_total
     FROM sd_delivery_supplies ds
     JOIN sd_supplies s ON s.id = ds.supply_id
     JOIN sd_supply_items i ON i.supply_id = ds.supply_id
     LEFT JOIN LATERAL (
       SELECT m.set_id FROM sd_product_channel_map m
       WHERE m.channel = s.channel AND m.set_id IS NOT NULL
         AND ((i.sku IS NOT NULL AND m.channel_sku = i.sku)
           OR (i.barcode IS NOT NULL AND m.channel_barcode = i.barcode))
       ORDER BY m.id LIMIT 1
     ) mm ON TRUE
     LEFT JOIN sd_sets st ON st.id = mm.set_id
     WHERE ds.delivery_id = ?`,
    id,
  );
  const finance = computeDeliveryFinance({
    delivery,
    packagingCost: agg?.packaging_cost || 0,
    laborMinutes: agg?.labor_minutes || 0,
    laborRatePerMin: await getLaborRatePerMin(),
    rewardTotal: agg?.reward_total || 0,
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

// ----- Книга сетов (артикул маркетплейса = комбинация артикулов склада) -----
const setSchema = z.object({
  name: z.string().min(1).max(200),
  article: z.string().max(200).optional().nullable(),
  warehouse_reward: z.number().nonnegative().optional().nullable(),
  packaging_tariff_id: z.number().int().positive().optional().nullable(),
  packaging_consumption: z.number().nonnegative().optional().default(0),
  packing_time_min: z.number().nonnegative().optional().default(0),
  dim_l: z.number().nonnegative().optional().nullable(),
  dim_w: z.number().nonnegative().optional().nullable(),
  dim_h: z.number().nonnegative().optional().nullable(),
});

router.get('/sets', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const search = (req.query.search || '').toString().trim();
  const filter = (req.query.filter || 'all').toString();
  const params = [];
  let where = '1=1';
  if (search) { where += ' AND st.name ILIKE ?'; params.push(`%${search}%`); }
  // Фильтры незаполненных сетов: без вознаграждения склада / без габаритов.
  if (filter === 'no_reward') where += ' AND (st.warehouse_reward IS NULL OR st.warehouse_reward = 0)';
  else if (filter === 'no_dims') where += ' AND (st.dim_l IS NULL OR st.dim_w IS NULL OR st.dim_h IS NULL)';
  const rows = await db.all(
    `SELECT st.*,
            COALESCE(c.cnt, 0) AS component_count,
            COALESCE(pk.cnt, 0) AS packaging_count,
            pk.summary AS packaging_summary,
            COALESCE(pk.cost, 0) AS packaging_cost
     FROM sd_sets st
     LEFT JOIN (SELECT set_id, COUNT(*) AS cnt FROM sd_set_components GROUP BY set_id) c ON c.set_id = st.id
     LEFT JOIN (
       SELECT sp.set_id, COUNT(*) AS cnt,
              STRING_AGG(COALESCE(t.name, '—'), ', ' ORDER BY sp.id) AS summary,
              SUM(sp.consumption * COALESCE(t.cost, 0)) AS cost
       FROM sd_set_packaging sp LEFT JOIN sd_packaging_tariffs t ON t.id = sp.packaging_tariff_id
       GROUP BY sp.set_id
     ) pk ON pk.set_id = st.id
     WHERE ${where}
     ORDER BY st.name LIMIT 500`,
    ...params,
  );
  // Предварительный доход сета = вознаграждение − упаковка − работа (мин × ставка).
  const rate = await getLaborRatePerMin();
  for (const r of rows) {
    const reward = Number(r.warehouse_reward) || 0;
    const packaging = Number(r.packaging_cost) || 0;
    const labor = (Number(r.packing_time_min) || 0) * rate;
    r.labor_cost = labor;
    r.preliminary_income = reward - packaging - labor;
  }
  res.json(rows);
}));

router.post('/sets', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = setSchema.parse(req.body);
  const row = await db.get(
    `INSERT INTO sd_sets (name, article, warehouse_reward, packaging_tariff_id, packaging_consumption, packing_time_min, dim_l, dim_w, dim_h, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    d.name, d.article ?? null, d.warehouse_reward ?? null, d.packaging_tariff_id ?? null, d.packaging_consumption ?? 0, d.packing_time_min ?? 0,
    d.dim_l ?? null, d.dim_w ?? null, d.dim_h ?? null, req.user.id,
  );
  res.json(row);
}));

// Подтянуть сеты из МойСклад: комплекты (bundle) из папки (по умолч. «Комплект RUS»)
// → sd_sets (name + article + ms_bundle_id) + состав (компоненты → товары CRM по
// external_id). ЧТЕНИЕ из МС (в МС ничего не пишем). Идемпотентно по ms_bundle_id.
router.post('/sets/pull-ms', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const token = await getMoyskladToken();
  if (!token) throw BadRequest('Не задан токен МойСклад (Настройки → Интеграция)');
  const folder = (req.body?.folder ?? 'Комплект RUS').toString().trim() || null;
  const offset = Math.max(0, parseInt(req.body?.offset, 10) || 0);
  // Папку резолвим в href один раз (на offset=0) и фронт носит его дальше — иначе
  // на каждой странице заново тянули бы список папок.
  let folderHref = (req.body?.folder_href || '').toString().trim() || null;
  try {
    if (folder && !folderHref) folderHref = await resolveMsFolderHref(token, folder);
  } catch (e) { throw BadRequest('МойСклад: ' + e.message); }
  // Одна страница комплектов ПАПКИ за запрос (фронт листает по has_more) — не ловим 504.
  let page;
  try { page = await fetchMoyskladBundlesPage(token, { folderHref, offset, limit: 50 }); }
  catch (e) { throw BadRequest('МойСклад: ' + e.message); }
  const bundles = page.bundles;
  // Батч-резолв товаров каталога по external_id всех компонентов страницы (вместо N+1).
  const allExt = [...new Set(bundles.flatMap((b) => b.components.map((c) => c.assortmentId)))];
  let prodByExt = new Map();
  if (allExt.length) {
    const prods = await db.all(
      "SELECT id, external_id FROM products WHERE external_source = 'moysklad' AND external_id = ANY(?)",
      allExt,
    );
    prodByExt = new Map(prods.map((p) => [p.external_id, p.id]));
  }
  let created = 0; let updated = 0; let compMapped = 0; let compUnmapped = 0;
  for (const b of bundles) {
    let set = await db.get('SELECT id FROM sd_sets WHERE ms_bundle_id = ?', b.externalId);
    if (set) {
      await db.run(
        'UPDATE sd_sets SET name = ?, article = COALESCE(?, article), ms_synced_at = NOW(), updated_at = NOW() WHERE id = ?',
        b.name || 'Комплект', b.article, set.id,
      );
      updated += 1;
    } else {
      set = await db.get(
        `INSERT INTO sd_sets (name, article, ms_bundle_id, ms_synced_at, created_by)
         VALUES (?, ?, ?, NOW(), ?) RETURNING id`,
        b.name || 'Комплект', b.article, b.externalId, req.user.id,
      );
      created += 1;
    }
    // Состав из МС — источник истины: пересобираем. Батч-вставка вместо построчной.
    await db.run('DELETE FROM sd_set_components WHERE set_id = ?', set.id);
    const rowsSql = []; const params = [];
    for (const c of b.components) {
      const pid = prodByExt.get(c.assortmentId);
      if (pid) { rowsSql.push('(?, ?, ?)'); params.push(set.id, pid, c.quantity); compMapped += 1; }
      else compUnmapped += 1;
    }
    if (rowsSql.length) {
      await db.run(`INSERT INTO sd_set_components (set_id, product_id, quantity) VALUES ${rowsSql.join(', ')}`, ...params);
    }
  }
  await logAction(req, { action: 'supply_delivery.sets.pull_ms', entity_type: 'sd_set', details: { matched: bundles.length, created, updated, offset } });
  res.json({
    ok: true,
    matched: bundles.length,
    created, updated,
    components_mapped: compMapped,
    components_unmapped: compUnmapped,
    has_more: page.hasMore,
    next_offset: page.nextOffset,
    scanned: page.scanned,
    total: page.total,
    folder_href: folderHref,
  });
}));

// Отправить сет в МойСклад: создать (если нет ms_bundle_id) или обновить комплект.
// ПИШЕТ В БОЕВОЙ МС. Ручное действие (кнопка «Отправить в МС»). Состав берётся из
// компонентов сета (только товары с external_id МойСклад).
router.post('/sets/:id/push-ms', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const token = await getMoyskladToken();
  if (!token) throw BadRequest('Не задан токен МойСклад (Настройки → Интеграция)');
  const set = await db.get('SELECT * FROM sd_sets WHERE id = ?', req.params.id);
  if (!set) throw NotFound('Сет не найден');
  const comps = await db.all(
    `SELECT sc.quantity, p.external_id, p.external_source
     FROM sd_set_components sc JOIN products p ON p.id = sc.product_id
     WHERE sc.set_id = ?`,
    req.params.id,
  );
  const usable = comps.filter((c) => c.external_source === 'moysklad' && c.external_id);
  if (!usable.length) throw BadRequest('У сета нет состава из МойСклад — добавь компоненты (товары МойСклад), потом отправляй');
  let result;
  try {
    result = await pushMoyskladBundle(token, {
      msBundleId: set.ms_bundle_id || null,
      name: set.name,
      article: set.article,
      components: usable.map((c) => ({ externalId: c.external_id, quantity: Number(c.quantity) || 1 })),
      folderName: 'Комплект RUS',
    });
  } catch (e) { throw BadRequest(e.message); }
  await db.run(
    'UPDATE sd_sets SET ms_bundle_id = COALESCE(ms_bundle_id, ?), article = COALESCE(article, ?), ms_synced_at = NOW(), updated_at = NOW() WHERE id = ?',
    result.id || null, result.article || null, set.id,
  );
  await logAction(req, { action: 'supply_delivery.sets.push_ms', entity_type: 'sd_set', entity_id: set.id, details: { created: !set.ms_bundle_id, ms_id: result.id } });
  res.json({ ok: true, ms_bundle_id: result.id || set.ms_bundle_id, created: !set.ms_bundle_id, article: result.article });
}));

router.get('/sets/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const set = await db.get('SELECT * FROM sd_sets WHERE id = ?', req.params.id);
  if (!set) throw NotFound('Сет не найден');
  const components = await db.all(
    `SELECT sc.id, sc.product_id, sc.quantity, p.sku, p.name
     FROM sd_set_components sc LEFT JOIN products p ON p.id = sc.product_id
     WHERE sc.set_id = ? ORDER BY sc.id`,
    req.params.id,
  );
  const packaging = await db.all(
    `SELECT sp.id, sp.packaging_tariff_id, sp.consumption,
            t.name AS tariff_name, t.unit AS tariff_unit, t.cost AS tariff_cost
     FROM sd_set_packaging sp LEFT JOIN sd_packaging_tariffs t ON t.id = sp.packaging_tariff_id
     WHERE sp.set_id = ? ORDER BY sp.id`,
    req.params.id,
  );
  // Артикулы маркетплейсов, привязанные к этому сету (по каналам).
  const channel_links = await db.all(
    `SELECT m.id, m.channel, m.channel_barcode, m.channel_sku, m.channel_name,
            m.channel_account_id, a.legal_entity
     FROM sd_product_channel_map m
     LEFT JOIN sd_channel_accounts a ON a.id = m.channel_account_id
     WHERE m.set_id = ? ORDER BY m.channel, m.id`,
    req.params.id,
  );
  // Ставка труда (₽/мин) — чтобы в редакторе показать предварительный доход
  // (вознаграждение − упаковка − время×ставка) и пересчитывать вживую.
  const laborRate = await getLaborRatePerMin();
  res.json({ ...set, components, packaging, channel_links, labor_rate_per_min: laborRate });
}));

router.put('/sets/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = setSchema.parse(req.body);
  const cur = await db.get('SELECT id FROM sd_sets WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Сет не найден');
  const row = await db.get(
    `UPDATE sd_sets SET name = ?, article = ?, warehouse_reward = ?, packaging_tariff_id = ?, packaging_consumption = ?, packing_time_min = ?,
       dim_l = ?, dim_w = ?, dim_h = ?, updated_at = NOW() WHERE id = ? RETURNING *`,
    d.name, d.article ?? null, d.warehouse_reward ?? null, d.packaging_tariff_id ?? null, d.packaging_consumption ?? 0, d.packing_time_min ?? 0,
    d.dim_l ?? null, d.dim_w ?? null, d.dim_h ?? null, req.params.id,
  );
  res.json(row);
}));

router.delete('/sets/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_sets WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.post('/sets/:id/components', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const set = await db.get('SELECT id FROM sd_sets WHERE id = ?', req.params.id);
  if (!set) throw NotFound('Сет не найден');
  const d = z.object({ product_id: z.number().int().positive(), quantity: z.number().positive().optional().default(1) }).parse(req.body);
  const prod = await db.get('SELECT id FROM products WHERE id = ?', d.product_id);
  if (!prod) throw NotFound('Товар не найден');
  await db.run('INSERT INTO sd_set_components (set_id, product_id, quantity) VALUES (?, ?, ?)', req.params.id, d.product_id, d.quantity ?? 1);
  res.json({ ok: true });
}));

router.delete('/sets/:id/components/:cid', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_set_components WHERE id = ? AND set_id = ?', req.params.cid, req.params.id);
  res.json({ ok: true });
}));

// Упаковка сета — несколько типов (стретч-плёнка + коробка + …).
router.post('/sets/:id/packaging', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const set = await db.get('SELECT id FROM sd_sets WHERE id = ?', req.params.id);
  if (!set) throw NotFound('Сет не найден');
  const d = z.object({
    packaging_tariff_id: z.number().int().positive(),
    consumption: z.number().nonnegative().optional().default(0),
  }).parse(req.body);
  const tar = await db.get('SELECT id FROM sd_packaging_tariffs WHERE id = ?', d.packaging_tariff_id);
  if (!tar) throw NotFound('Тариф упаковки не найден');
  await db.run(
    'INSERT INTO sd_set_packaging (set_id, packaging_tariff_id, consumption) VALUES (?, ?, ?)',
    req.params.id, d.packaging_tariff_id, d.consumption ?? 0,
  );
  res.json({ ok: true });
}));

router.delete('/sets/:id/packaging/:pid', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_set_packaging WHERE id = ? AND set_id = ?', req.params.pid, req.params.id);
  res.json({ ok: true });
}));

// Привязать к сету артикул маркетплейса (по каналам) прямо из карточки сета.
// Либо связать существующую строку канала (map_id), либо создать её вручную
// (channel + barcode/sku [+ name]) и сразу связать. Отвязка — через
// PUT /channel-map/:mapId/unmatch.
router.post('/sets/:id/channel-links', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const set = await db.get('SELECT id FROM sd_sets WHERE id = ?', req.params.id);
  if (!set) throw NotFound('Сет не найден');
  const d = z.object({
    channel: z.enum(['wb', 'ozon', 'ym', 'avito']),
    channel_account_id: z.number().int().positive().optional().nullable(),
    map_id: z.number().int().positive().optional().nullable(),
    barcode: z.string().max(120).optional().nullable(),
    sku: z.string().max(120).optional().nullable(),
    name: z.string().max(400).optional().nullable(),
  }).parse(req.body);
  if (d.map_id) {
    const r = await db.run(
      'UPDATE sd_product_channel_map SET set_id = ?, matched_at = NOW(), updated_at = NOW() WHERE id = ? AND channel = ?',
      req.params.id, d.map_id, d.channel,
    );
    if (!r.changes) throw NotFound('Строка канала не найдена');
    return res.json({ ok: true });
  }
  if (!d.barcode && !d.sku) throw BadRequest('Укажите штрихкод или артикул канала');
  await db.run(
    `INSERT INTO sd_product_channel_map (channel, channel_barcode, channel_sku, channel_name, channel_account_id, set_id, matched_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (channel, COALESCE(channel_barcode, ''), COALESCE(channel_sku, ''))
     DO UPDATE SET set_id = EXCLUDED.set_id,
                   channel_account_id = COALESCE(EXCLUDED.channel_account_id, sd_product_channel_map.channel_account_id),
                   channel_name = COALESCE(EXCLUDED.channel_name, sd_product_channel_map.channel_name),
                   matched_at = NOW(), updated_at = NOW()`,
    d.channel, d.barcode ?? null, d.sku ?? null, d.name ?? null, d.channel_account_id ?? null, req.params.id,
  );
  res.json({ ok: true });
}));

// ----- Matching номенклатуры канала ⇄ сет (Phase 3, WB первый) -----
router.get('/channel-map', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const channel = (req.query.channel || 'wb').toString();
  const status = (req.query.status || 'all').toString();
  const search = (req.query.search || '').toString().trim();
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const accId = parseInt(req.query.channel_account_id, 10);
  const hasAcc = Number.isInteger(accId) && accId > 0;
  // Видимость: active (по умолчанию — прячем скрытые), hidden (только скрытые), all.
  const visibility = (req.query.visibility || 'active').toString();
  const params = [channel];
  let where = 'm.channel = ?';
  if (status === 'matched') where += ' AND m.set_id IS NOT NULL';
  else if (status === 'unmatched') where += ' AND m.set_id IS NULL';
  if (visibility === 'active') where += ' AND m.hidden = FALSE';
  else if (visibility === 'hidden') where += ' AND m.hidden = TRUE';
  if (search) {
    where += ' AND (m.channel_barcode ILIKE ? OR m.channel_sku ILIKE ? OR m.channel_name ILIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (hasAcc) { where += ' AND m.channel_account_id = ?'; params.push(accId); }
  const rows = await db.all(
    `SELECT m.*, st.name AS set_name, a.legal_entity
     FROM sd_product_channel_map m
     LEFT JOIN sd_sets st ON st.id = m.set_id
     LEFT JOIN sd_channel_accounts a ON a.id = m.channel_account_id
     WHERE ${where}
     ORDER BY (m.set_id IS NULL) DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  // Счётчики — по каналу (и по юрлицу, если фильтруем), без учёта статуса/поиска/видимости.
  const countParams = [channel];
  let countWhere = 'channel = ?';
  if (hasAcc) { countWhere += ' AND channel_account_id = ?'; countParams.push(accId); }
  const counts = await db.get(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE set_id IS NOT NULL) AS matched,
            COUNT(*) FILTER (WHERE hidden = TRUE) AS hidden
     FROM sd_product_channel_map WHERE ${countWhere}`,
    ...countParams,
  );
  res.json({
    rows,
    total: Number(counts?.total) || 0,
    matched: Number(counts?.matched) || 0,
    hidden: Number(counts?.hidden) || 0,
    has_more: rows.length === limit,
    offset,
    limit,
  });
}));

// Сверка габаритов: кабинет МП (channel_dim_*) ⇄ наш сет (sd_sets.dim_*). CRM —
// эталон; отклонение = |МП − CRM| / CRM × 100 по каждой стороне; over = превышен порог.
router.get('/size-map', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const channel = (req.query.channel || 'wb').toString();
  const threshold = Math.max(0, parseFloat(req.query.threshold) || 10);
  const rows = await db.all(
    `SELECT m.id, m.channel, m.channel_sku, m.channel_barcode, m.channel_name,
            m.channel_dim_l, m.channel_dim_w, m.channel_dim_h,
            st.id AS set_id, st.name AS set_name, st.dim_l AS set_dim_l, st.dim_w AS set_dim_w, st.dim_h AS set_dim_h,
            a.legal_entity
     FROM sd_product_channel_map m
     JOIN sd_sets st ON st.id = m.set_id
     LEFT JOIN sd_channel_accounts a ON a.id = m.channel_account_id
     WHERE m.channel = ?
       AND (m.channel_dim_l IS NOT NULL OR m.channel_dim_w IS NOT NULL OR m.channel_dim_h IS NOT NULL)
     ORDER BY m.id DESC LIMIT 1000`,
    channel,
  );
  const dev = (mp, crm) => {
    if (mp == null || crm == null || Number(crm) === 0) return null;
    return Math.abs(Number(mp) - Number(crm)) / Number(crm) * 100;
  };
  const out = rows.map((r) => {
    const dl = dev(r.channel_dim_l, r.set_dim_l);
    const dw = dev(r.channel_dim_w, r.set_dim_w);
    const dh = dev(r.channel_dim_h, r.set_dim_h);
    const vals = [dl, dw, dh].filter((x) => x != null);
    const maxDev = vals.length ? Math.max(...vals) : null;
    return { ...r, dev_l: dl, dev_w: dw, dev_h: dh, max_dev: maxDev, over: maxDev != null && maxDev > threshold };
  });
  res.json({ rows: out, threshold, over_count: out.filter((r) => r.over).length });
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

// Общий батч-upsert номенклатуры канала (используется всеми pull-* эндпоинтами).
// items = [{ channel_barcode, channel_sku, channel_name, channel_extra, channel_dim_* }].
async function upsertChannelItems(channel, channelAccountId, items) {
  // Дедуп по ключу конфликта: иначе при повторе штрихкода в одном батче Postgres
  // падает «ON CONFLICT cannot affect row twice». Последняя запись по ключу побеждает.
  const uniq = new Map();
  for (const it of items) {
    if (!it.channel_barcode && !it.channel_sku) continue;
    uniq.set(`${it.channel_barcode || ''}|${it.channel_sku || ''}`, it);
  }
  const valid = [...uniq.values()];
  let n = 0;
  const CHUNK = 200;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const rowsSql = [];
    const params = [];
    for (const it of chunk) {
      rowsSql.push('(?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)');
      params.push(channel, it.channel_barcode ?? null, it.channel_sku ?? null, it.channel_name ?? null,
        JSON.stringify(it.channel_extra || {}), channelAccountId,
        it.channel_dim_l ?? null, it.channel_dim_w ?? null, it.channel_dim_h ?? null);
    }
    await db.run(
      `INSERT INTO sd_product_channel_map (channel, channel_barcode, channel_sku, channel_name, channel_extra, channel_account_id, channel_dim_l, channel_dim_w, channel_dim_h)
       VALUES ${rowsSql.join(', ')}
       ON CONFLICT (channel, COALESCE(channel_barcode, ''), COALESCE(channel_sku, ''))
       DO UPDATE SET channel_name = EXCLUDED.channel_name, channel_extra = EXCLUDED.channel_extra,
                     channel_account_id = EXCLUDED.channel_account_id,
                     channel_dim_l = EXCLUDED.channel_dim_l, channel_dim_w = EXCLUDED.channel_dim_w, channel_dim_h = EXCLUDED.channel_dim_h,
                     updated_at = NOW()`,
      ...params,
    );
    n += chunk.length;
  }
  return n;
}

// Подтяжка номенклатуры WB через API (ключ берётся из справочника «Каналы»).
router.post('/channel-map/pull-wb', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel_account_id } = z.object({ channel_account_id: z.number().int().positive() }).parse(req.body);
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', channel_account_id, 'wb');
  if (!acc) throw BadRequest('Не найден WB-канал с ключом. Заведите его в справочнике «Каналы».');
  if (!acc.api_key_enc) throw BadRequest('У этого канала не задан API-ключ');
  const key = decryptSecret(acc.api_key_enc);
  let items;
  try { items = await fetchWbCards(key, { limit: 100 }); }
  catch (e) { throw BadRequest(e.message); }
  const n = await upsertChannelItems('wb', channel_account_id, items);
  res.json({ ok: true, pulled: n, legal_entity: acc.legal_entity });
}));

// Подтяжка номенклатуры Ozon (Client-Id + Api-Key в JSON api_key_enc).
router.post('/channel-map/pull-ozon', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel_account_id } = z.object({ channel_account_id: z.number().int().positive() }).parse(req.body);
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', channel_account_id, 'ozon');
  if (!acc) throw BadRequest('Не найден Ozon-канал с ключом. Заведите его в справочнике «Каналы».');
  if (!acc.api_key_enc) throw BadRequest('У этого канала не задан ключ Ozon (Client-Id + Api-Key)');
  const key = decryptSecret(acc.api_key_enc);
  let items;
  try { items = await fetchOzonCards(key); }
  catch (e) { throw BadRequest(e.message); }
  const n = await upsertChannelItems('ozon', channel_account_id, items);
  res.json({ ok: true, pulled: n, received: items.length, legal_entity: acc.legal_entity });
}));

// Подтяжка номенклатуры Яндекс Маркет (business_id + OAuth-токен в JSON api_key_enc).
router.post('/channel-map/pull-ym', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel_account_id } = z.object({ channel_account_id: z.number().int().positive() }).parse(req.body);
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', channel_account_id, 'ym');
  if (!acc) throw BadRequest('Не найден ЯМ-канал с ключом. Заведите его в справочнике «Каналы».');
  if (!acc.api_key_enc) throw BadRequest('У этого канала не задан ключ ЯМ (токен + business_id)');
  const key = decryptSecret(acc.api_key_enc);
  let items;
  try { items = await fetchYmCards(key); }
  catch (e) { throw BadRequest(e.message); }
  const n = await upsertChannelItems('ym', channel_account_id, items);
  res.json({ ok: true, pulled: n, received: items.length, legal_entity: acc.legal_entity });
}));

// Авто-сопоставление: артикул канала = артикул склада-компонента какого-то сета.
router.post('/channel-map/auto-match', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel } = z.object({ channel: z.enum(['wb', 'ozon', 'ym', 'avito']) }).parse(req.body);
  const r = await db.run(
    `UPDATE sd_product_channel_map m
     SET set_id = x.set_id, matched_at = NOW(), updated_at = NOW()
     FROM (SELECT sc.set_id, p.sku FROM sd_set_components sc JOIN products p ON p.id = sc.product_id) x
     WHERE m.channel = ? AND m.set_id IS NULL
       AND m.channel_sku IS NOT NULL AND x.sku = m.channel_sku`,
    channel,
  );
  res.json({ ok: true, matched: r.changes || 0 });
}));

// Авто-сопоставление по АРТИКУЛУ СЕТА. Поле артикула канала, равное артикулу сета,
// зависит от площадки: WB — артикул продавца (channel_sku), Ozon — штрихкод
// (channel_barcode), ЯМ — SKU (channel_sku). field — из фиксированного списка (не инъекция).
router.post('/channel-map/auto-match-article', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel } = z.object({ channel: z.enum(['wb', 'ozon', 'ym', 'avito']) }).parse(req.body);
  const field = channel === 'ozon' ? 'channel_barcode' : 'channel_sku';
  const r = await db.run(
    `UPDATE sd_product_channel_map m
     SET set_id = st.id, matched_at = NOW(), updated_at = NOW()
     FROM sd_sets st
     WHERE m.channel = ? AND m.set_id IS NULL
       AND st.article IS NOT NULL AND st.article <> ''
       AND m.${field} = st.article`,
    channel,
  );
  res.json({ ok: true, matched: r.changes || 0, field });
}));

router.put('/channel-map/:id/match', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { set_id } = z.object({ set_id: z.number().int().positive() }).parse(req.body);
  const st = await db.get('SELECT id FROM sd_sets WHERE id = ?', set_id);
  if (!st) throw NotFound('Сет не найден');
  await db.run('UPDATE sd_product_channel_map SET set_id = ?, matched_at = NOW(), updated_at = NOW() WHERE id = ?', set_id, req.params.id);
  res.json({ ok: true });
}));

router.put('/channel-map/:id/unmatch', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('UPDATE sd_product_channel_map SET set_id = NULL, matched_at = NULL, updated_at = NOW() WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

router.delete('/channel-map/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  await db.run('DELETE FROM sd_product_channel_map WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// Скрыть/показать одну строку (чтобы не листать длинную таблицу на телефоне).
router.put('/channel-map/:id/hidden', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
  await db.run('UPDATE sd_product_channel_map SET hidden = ?, updated_at = NOW() WHERE id = ?', hidden, req.params.id);
  res.json({ ok: true });
}));

// Массово скрыть уже сопоставленные строки канала — оставить в списке только то,
// что ещё нужно сопоставить.
router.post('/channel-map/hide-matched', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const { channel } = z.object({ channel: z.enum(['wb', 'ozon', 'ym', 'avito']) }).parse(req.body);
  const r = await db.run(
    'UPDATE sd_product_channel_map SET hidden = TRUE, updated_at = NOW() WHERE channel = ? AND set_id IS NOT NULL AND hidden = FALSE',
    channel,
  );
  res.json({ ok: true, hidden: r.changes || 0 });
}));

// ----- WB ФБС: процесс поставки (создать поставку → задания → штрихкод → доставка) -----
async function loadWbSupply(id) {
  const s = await db.get('SELECT * FROM sd_supplies WHERE id = ?', id);
  if (!s) throw NotFound('Поставка не найдена');
  if (s.channel !== 'wb') throw BadRequest('Это не WB-поставка');
  return s;
}

router.post('/supplies/:id/wb/create-supply', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  if (s.external_supply_id) throw BadRequest('Поставка в WB уже создана: ' + s.external_supply_id);
  const key = await wbKeyForSupply(s);
  const supplyId = await wbCreateSupply(key, s.title || `CRM #${s.id}`);
  if (!supplyId) throw BadRequest('WB не вернул supplyId');
  await db.run('UPDATE sd_supplies SET external_supply_id = ?, external_status = ?, updated_at = NOW() WHERE id = ?', supplyId, 'created', s.id);
  res.json({ ok: true, external_supply_id: supplyId });
}));

router.get('/supplies/:id/wb/new-orders', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  const key = await wbKeyForSupply(s);
  res.json(await wbNewOrders(key));
}));

router.post('/supplies/:id/wb/attach-order', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  if (!s.external_supply_id) throw BadRequest('Сначала создайте поставку в WB');
  const d = z.object({
    order_id: z.string().min(1),
    article: z.string().optional().nullable(),
    barcode: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
  }).parse(req.body);
  const key = await wbKeyForSupply(s);
  await wbAddOrderToSupply(key, s.external_supply_id, d.order_id);
  await db.run(
    `INSERT INTO sd_supply_items (supply_id, sku, name, quantity, external_order_id, barcode)
     VALUES (?, ?, ?, 1, ?, ?)`,
    s.id, d.article ?? null, d.name ?? d.article ?? null, d.order_id, d.barcode ?? null,
  );
  res.json({ ok: true });
}));

// Привязать ВСЕ свободные сборочные задания (те, что показывает /new-orders) к этой
// поставке. Параллельность 5 (rate-limit WB ~100 req/min). Ошибки по конкретным
// заданиям не прерывают — собираем в errors[]. Автоматически создаёт поставку в WB,
// если её ещё не было (для «в один клик» из UI).
router.post('/supplies/:id/wb/attach-all', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  const key = await wbKeyForSupply(s);
  // Если ещё не создана в WB — создать сейчас.
  let extId = s.external_supply_id;
  if (!extId) {
    extId = await wbCreateSupply(key, s.title || `CRM #${s.id}`);
    if (!extId) throw BadRequest('WB не вернул supplyId при создании');
    await db.run(
      'UPDATE sd_supplies SET external_supply_id = ?, external_status = ?, updated_at = NOW() WHERE id = ?',
      extId, 'created', s.id,
    );
  }
  const orders = await wbNewOrders(key);
  if (!orders.length) return res.json({ ok: true, attached: 0, errors: [], external_supply_id: extId });
  const CONCURRENCY = 5;
  let attached = 0;
  const errors = [];
  const attachedRows = [];
  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    const slice = orders.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (o) => {
      try {
        await wbAddOrderToSupply(key, extId, o.order_id);
        attached += 1;
        attachedRows.push([s.id, o.article ?? null, o.name ?? o.article ?? null, 1, String(o.order_id), o.barcode ?? null]);
      } catch (e) {
        errors.push({ order_id: o.order_id, error: e.message });
      }
    }));
  }
  // Батч-INSERT позиций в CRM (одним запросом вместо N).
  if (attachedRows.length) {
    const placeholders = attachedRows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = attachedRows.flat();
    await db.run(
      `INSERT INTO sd_supply_items (supply_id, sku, name, quantity, external_order_id, barcode)
       VALUES ${placeholders}`,
      ...params,
    ).catch((e) => console.error('[attach-all] items insert:', e.message));
  }
  await logAction(req, { action: 'supply_delivery.wb.attach_all', entity_type: 'sd_supply', entity_id: s.id, details: { attached, total: orders.length, errors: errors.length } });
  res.json({ ok: true, attached, total: orders.length, errors, external_supply_id: extId });
}));

router.get('/supplies/:id/wb/barcode', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  if (!s.external_supply_id) throw BadRequest('Поставка в WB не создана');
  const key = await wbKeyForSupply(s);
  res.json(await wbSupplyBarcode(key, s.external_supply_id, (req.query.type || 'svg').toString()));
}));

router.post('/supplies/:id/wb/deliver', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const s = await loadWbSupply(req.params.id);
  if (!s.external_supply_id) throw BadRequest('Поставка в WB не создана');
  const key = await wbKeyForSupply(s);
  await wbDeliverSupply(key, s.external_supply_id);
  await db.run("UPDATE sd_supplies SET external_status = 'delivered', status = 'shipped', updated_at = NOW() WHERE id = ?", s.id);
  res.json({ ok: true });
}));

// Список WB-каналов для выбора при создании поставки (без ключей, для operate).
router.get('/wb/accounts', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    "SELECT id, legal_entity FROM sd_channel_accounts WHERE channel = 'wb' AND active IS NOT FALSE ORDER BY legal_entity, id",
  ));
}));

// Все каналы-аккаунты (канал + юрлицо, без ключей) — для сопоставления сета
// с конкретным заведённым каналом (напр. «WB · ИП Иваненко»), а не абстрактным.
router.get('/channel-accounts-lite', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all(
    'SELECT id, channel, legal_entity FROM sd_channel_accounts WHERE active IS NOT FALSE ORDER BY channel, legal_entity, id',
  ));
}));

router.get('/wb/reshipment', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const accId = parseInt(req.query.channel_account_id, 10);
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', accId, 'wb');
  if (!acc || !acc.api_key_enc) throw BadRequest('Укажите WB-канал с ключом');
  const key = decryptSecret(acc.api_key_enc);
  res.json(await wbReshipmentOrders(key));
}));

// ----- WB ФБО: список складов приёмки + коэффициенты (платность/бесплатность) -----
// Ключ берём из поставки (её channel_account_id). Отдаём как есть — фронт группирует.
async function loadWbKey(channelAccountId) {
  const acc = await db.get('SELECT * FROM sd_channel_accounts WHERE id = ? AND channel = ?', channelAccountId, 'wb');
  if (!acc || !acc.api_key_enc) throw BadRequest('Укажите WB-канал с ключом');
  return decryptSecret(acc.api_key_enc);
}

router.get('/wb/fbo/warehouses', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const accId = parseInt(req.query.channel_account_id, 10);
  if (!accId) throw BadRequest('Не задан channel_account_id (WB-канал)');
  const key = await loadWbKey(accId);
  try { res.json(await wbFboListWarehouses(key)); }
  catch (e) { throw BadRequest(e.message); }
}));

router.get('/wb/fbo/coefficients', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const accId = parseInt(req.query.channel_account_id, 10);
  if (!accId) throw BadRequest('Не задан channel_account_id (WB-канал)');
  const key = await loadWbKey(accId);
  const wIDs = (req.query.warehouseIDs || '').toString().split(',').map((x) => x.trim()).filter(Boolean);
  try { res.json(await wbFboAcceptanceCoefficients(key, wIDs)); }
  catch (e) { throw BadRequest(e.message); }
}));

// Установить/обновить план ФБО-поставки в CRM (склад + дата приёмки). WB заявку
// создаёт менеджер вручную в кабинете — CRM хранит план и позиции для копипаста.
// Хранится в sd_supplies.external_meta JSONB (не трогает note менеджера).
router.patch('/supplies/:id/fbo-plan', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const cur = await db.get('SELECT id, model, external_meta FROM sd_supplies WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Поставка не найдена');
  if (cur.model !== 'fbo') throw BadRequest('Это не ФБО-поставка');
  const d = z.object({
    warehouse_id: z.union([z.number(), z.string()]).optional().nullable(),
    warehouse_name: z.string().max(200).optional().nullable(),
    plan_date: z.string().max(40).optional().nullable(),
    coefficient: z.number().optional().nullable(),
    box_type: z.string().max(60).optional().nullable(),
  }).parse(req.body);
  const meta = { ...(cur.external_meta || {}) };
  if (d.warehouse_id !== undefined) meta.fbo_warehouse_id = d.warehouse_id ?? null;
  if (d.warehouse_name !== undefined) meta.fbo_warehouse_name = d.warehouse_name ?? null;
  if (d.plan_date !== undefined) meta.fbo_plan_date = d.plan_date ?? null;
  if (d.coefficient !== undefined) meta.fbo_coefficient = d.coefficient ?? null;
  if (d.box_type !== undefined) meta.fbo_box_type = d.box_type ?? null;
  await db.run(
    'UPDATE sd_supplies SET external_meta = ?::jsonb, updated_at = NOW() WHERE id = ?',
    JSON.stringify(meta), req.params.id,
  );
  res.json({ ok: true, external_meta: meta });
}));

export default router;
