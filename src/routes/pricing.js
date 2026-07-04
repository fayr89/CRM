// Правила цен: проценты по способу оплаты и пороги скидок по сумме заказа.
// Хранятся в app_settings (JSONB). Применяются в форме заказа.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import {
  currentPriceRevision, getUserPriceAck, isUserPriceCurrent,
  acknowledgeUserPrice, priceAckRequiredForRole, ensurePriceAckTable,
  ACK_REQUIRED_ROLES,
} from '../services/priceRevision.js';

const router = Router();

router.use(authenticate);

// ===== Ревизия прайса и подтверждения (ознакомление менеджеров) =====

// Состояние для текущего пользователя: когда прайс менялся, подтвердил ли он,
// требуется ли ему подтверждение и заблокирован ли он.
router.get(
  '/revision',
  asyncHandler(async (req, res) => {
    const [revision, ack, current] = await Promise.all([
      currentPriceRevision(),
      getUserPriceAck(req.user.id),
      isUserPriceCurrent(req.user.id),
    ]);
    res.json({
      revision_at: revision ? revision.toISOString() : null,
      my_ack_at: ack?.acknowledged_at ?? null,
      my_ack_revision_at: ack?.acknowledged_revision_at ?? null,
      is_current: current,
      requires_ack: priceAckRequiredForRole(req.user.role),
      // blocked = роль продающая И не ознакомлен с актуальной ревизией
      blocked: priceAckRequiredForRole(req.user.role) && !current,
    });
  }),
);

// Подтвердить ознакомление с текущим прайсом.
router.post(
  '/acknowledge',
  asyncHandler(async (req, res) => {
    const revision = await acknowledgeUserPrice(req.user.id);
    res.json({ ok: true, acknowledged_revision_at: revision ? revision.toISOString() : null });
  }),
);

// Для админа/РОПа: кто из продающих ознакомился с актуальным прайсом, кто нет.
router.get(
  '/ack-status',
  requireRole('admin', 'rop', 'aus'),
  asyncHandler(async (_req, res) => {
    await ensurePriceAckTable();
    const revision = await currentPriceRevision();
    const revMs = revision ? revision.getTime() : null;
    const rows = await db.all(
      `SELECT u.id, u.name, u.email, u.role,
              a.acknowledged_at, a.acknowledged_revision_at
       FROM users u
       LEFT JOIN price_acknowledgements a ON a.user_id = u.id
       WHERE u.role = ANY(?) AND u.active IS NOT FALSE
       ORDER BY u.name`,
      ACK_REQUIRED_ROLES,
    );
    const managers = rows.map((r) => {
      const ackMs = r.acknowledged_revision_at ? new Date(r.acknowledged_revision_at).getTime() : null;
      const is_current = revMs == null ? true : (ackMs != null && ackMs >= revMs);
      return {
        id: r.id, name: r.name, email: r.email, role: r.role,
        acknowledged_at: r.acknowledged_at, is_current,
      };
    });
    res.json({
      revision_at: revision ? revision.toISOString() : null,
      total: managers.length,
      confirmed: managers.filter((m) => m.is_current).length,
      managers,
    });
  }),
);

const DEFAULT_PAYMENT_METHODS = [
  { key: 'cash_card', label: 'Наличные / Перевод на карту', percent: 0 },
  { key: 'rs_no_vat', label: 'На РС (Без НДС)', percent: 0 },
  { key: 'rs_vat', label: 'На РС (С НДС)', percent: 0 },
  { key: 'avito_delivery', label: 'Авито доставка', percent: 0 },
];
const DEFAULT_ORDER_TIERS = [];

async function getSetting(key, fallback) {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

async function loadPricing() {
  const [saved, order_tiers] = await Promise.all([
    getSetting('pricing.payment_methods', DEFAULT_PAYMENT_METHODS),
    getSetting('pricing.order_tiers', DEFAULT_ORDER_TIERS),
  ]);
  // Гарантируем наличие обязательных методов (например «Авито доставка») даже если
  // у пользователя сохранён старый набор без них — иначе не сработает логика отгрузок.
  const payment_methods = Array.isArray(saved) ? [...saved] : [...DEFAULT_PAYMENT_METHODS];
  for (const def of DEFAULT_PAYMENT_METHODS) {
    if (!payment_methods.some((m) => m.key === def.key)) payment_methods.push(def);
  }
  return { payment_methods, order_tiers };
}

// Видно всем (нужно менеджеру в форме заказа), менять — только админ.
router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json(await loadPricing());
  }),
);

const pmSchema = z
  .array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      percent: z.number().finite(),
    }),
  )
  .max(20);

const tierSchema = z
  .array(
    z.object({
      threshold: z.number().nonnegative(),
      percent: z.number().finite(),
    }),
  )
  .max(50);

const putSchema = z.object({
  payment_methods: pmSchema.optional(),
  order_tiers: tierSchema.optional(),
});

async function upsertSetting(tx, key, value, userId) {
  await tx.run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?::jsonb, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    key,
    JSON.stringify(value),
    userId,
  );
}

router.put(
  '/settings',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = putSchema.parse(req.body);
    await db.withTransaction(async (tx) => {
      // На пулере соединение могло «застрять» без таблицы — гарантируем её в той же транзакции.
      await tx.run(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY, value JSONB NOT NULL,
           updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
      );
      if (data.payment_methods) {
        await upsertSetting(tx, 'pricing.payment_methods', data.payment_methods, req.user.id);
      }
      if (data.order_tiers) {
        const sorted = [...data.order_tiers].sort((a, b) => a.threshold - b.threshold);
        await upsertSetting(tx, 'pricing.order_tiers', sorted, req.user.id);
      }
    });
    res.json(await loadPricing());
  }),
);

export default router;
