// Единый /api/bootstrap: параллельно тянет всё нужное для первичной загрузки
// клиента одним HTTP-запросом. Заменяет 6-7 параллельных вызовов (notifications
// count, feedback open, my feedback, banners, ai proposals, price revision,
// supply delivery flag) → 1 cold-start лямбды вместо семи.
//
// Клиент вызывает раз при mount shell, дальше подпитывается periodic-опросами
// (см. app.js). Все запросы БД идут через Promise.all — суммарная задержка
// = max(тайм каждого), а не sum.
import { Router } from 'express';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import {
  currentPriceRevision, getUserPriceAck, isUserPriceCurrent,
} from '../services/priceRevision.js';
import {
  getSupplyDeliveryConfig, canSeeSupplyDelivery, canOperateSupplyDelivery,
  priceAckRequiredForRole,
} from '../services/featureFlags.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const isAdmin = req.user.role === 'admin';
  // Все запросы — параллельно. Каждый обёрнут в catch, чтобы одна ошибка
  // не роняла весь bootstrap (клиент получит `null` в этом поле, работа шелла
  // не прервётся).
  const [
    notif, myFbk, feedbackOpen, banners, aiPending, priceRev, ack, isCurrent, sdCfg,
  ] = await Promise.all([
    db.get(
      `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL`,
      uid,
    ).catch(() => ({ unread: 0 })),
    db.get(
      `SELECT COUNT(*)::int AS awaiting FROM feedback WHERE user_id = ? AND status = 'awaiting_approval'`,
      uid,
    ).catch(() => ({ awaiting: 0 })),
    isAdmin ? db.get(
      `SELECT COUNT(*)::int AS open FROM feedback WHERE status = 'open'`,
    ).catch(() => ({ open: 0 })) : Promise.resolve({ open: 0 }),
    db.all(
      `SELECT id, text, kind, starts_at, ends_at, dismissible FROM notice_banners
       WHERE NOW() BETWEEN starts_at AND ends_at ORDER BY created_at DESC`,
    ).catch(() => []),
    isAdmin ? db.get(
      `SELECT COUNT(*)::int AS n FROM ai_proposals WHERE status IN ('pending','revision')`,
    ).catch(() => ({ n: 0 })) : Promise.resolve({ n: 0 }),
    currentPriceRevision().catch(() => null),
    getUserPriceAck(uid).catch(() => null),
    isUserPriceCurrent(uid).catch(() => true),
    getSupplyDeliveryConfig().catch(() => ({ enabled: false })),
  ]);
  res.json({
    notifications_unread: notif?.unread || 0,
    my_feedback_awaiting: myFbk?.awaiting || 0,
    feedback_open: feedbackOpen?.open || 0,
    banners: banners || [],
    ai_proposals_pending: aiPending?.n || 0,
    price_revision: {
      revision_at: priceRev ? priceRev.toISOString() : null,
      my_ack_at: ack?.acknowledged_at ?? null,
      my_ack_revision_at: ack?.acknowledged_revision_at ?? null,
      is_current: isCurrent,
      requires_ack: priceAckRequiredForRole(req.user.role),
      show_banner: priceAckRequiredForRole(req.user.role) && !isCurrent,
    },
    supply_delivery_flag: {
      visible: canSeeSupplyDelivery(req.user, sdCfg),
      can_operate: canOperateSupplyDelivery(req.user, sdCfg),
      enabled: !!sdCfg?.enabled,
      is_admin: isAdmin,
    },
  });
}));

export default router;
