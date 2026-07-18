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
import { Forbidden, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import {
  getSupplyDeliveryConfig, setSupplyDeliveryConfig,
  canSeeSupplyDelivery, canOperateSupplyDelivery,
} from '../services/featureFlags.js';

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

export default router;
