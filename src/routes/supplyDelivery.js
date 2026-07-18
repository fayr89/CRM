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
} from '../services/supplyDeliverySchema.js';

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

// ----- Тарифы упаковки (с историей изменений) -----
const tariffSchema = z.object({
  name: z.string().min(1).max(120),
  cost: z.number().nonnegative(),
  time_norm_min: z.number().nonnegative(),
});

router.get('/packaging-tariffs', requireOperate, asyncHandler(async (_req, res) => {
  await ensureSupplyDeliverySchema();
  res.json(await db.all('SELECT * FROM sd_packaging_tariffs WHERE active = TRUE ORDER BY name'));
}));

router.post('/packaging-tariffs', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = tariffSchema.parse(req.body);
  const row = await db.get(
    'INSERT INTO sd_packaging_tariffs (name, cost, time_norm_min) VALUES (?, ?, ?) RETURNING *',
    d.name, d.cost, d.time_norm_min,
  );
  await db.run(
    'INSERT INTO sd_packaging_tariff_history (tariff_id, cost, time_norm_min, changed_by) VALUES (?, ?, ?, ?)',
    row.id, d.cost, d.time_norm_min, req.user.id,
  );
  res.json(row);
}));

router.put('/packaging-tariffs/:id', requireOperate, asyncHandler(async (req, res) => {
  await ensureSupplyDeliverySchema();
  const d = tariffSchema.parse(req.body);
  const cur = await db.get('SELECT * FROM sd_packaging_tariffs WHERE id = ?', req.params.id);
  if (!cur) throw NotFound('Тариф не найден');
  const row = await db.get(
    'UPDATE sd_packaging_tariffs SET name = ?, cost = ?, time_norm_min = ?, updated_at = NOW() WHERE id = ? RETURNING *',
    d.name, d.cost, d.time_norm_min, req.params.id,
  );
  // История — только при реальном изменении стоимости/норматива (старые доставки
  // не пересчитываются: они снапшотят тариф на момент расчёта — это Phase 2b).
  if (Number(cur.cost) !== d.cost || Number(cur.time_norm_min) !== d.time_norm_min) {
    await db.run(
      'INSERT INTO sd_packaging_tariff_history (tariff_id, cost, time_norm_min, changed_by) VALUES (?, ?, ?, ?)',
      req.params.id, d.cost, d.time_norm_min, req.user.id,
    );
  }
  res.json(row);
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

export default router;
