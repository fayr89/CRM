// ВРЕМЕННЫЙ diag-endpoint для проверки цепочки уведомлений по складам.
// GET /api/diag/stock-status-v1?key=stock-check-2026-b8n5
// После использования — снести отдельным коммитом.

import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET_KEY = 'stock-check-2026-b8n5';

router.get(
  '/stock-status-v1',
  asyncHandler(async (req, res) => {
    if (req.query.key !== SECRET_KEY) return res.status(401).json({ error: 'bad key' });

    const info = {};

    // 1. Мои подписки (по email admin — foreman@iitit.ru? нет, определить кто admin в системе).
    try {
      info.subscriptions_total = (await db.get(`SELECT COUNT(*)::int AS n FROM user_stock_watches`)).n;
    } catch (e) { info.subscriptions_error = e.message; }

    try {
      info.subscribers_by_warehouse = await db.all(
        `SELECT warehouse, COUNT(*)::int AS n,
                bool_or(watch_reserve) AS any_reserve,
                bool_or(watch_ship) AS any_ship,
                bool_or(watch_receipt) AS any_receipt
         FROM user_stock_watches GROUP BY warehouse`,
      );
    } catch (e) { info.subscribers_error = e.message; }

    // 2. Есть ли МС-токен.
    try {
      const t = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad_token'`);
      info.ms_token_present = !!t?.value;
    } catch (e) { info.ms_token_error = e.message; }

    // 3. Snapshots — есть ли, когда последний прогон.
    try {
      const s = await db.get(`SELECT COUNT(*)::int AS n, MAX(snapshot_at) AS last_at FROM stock_ms_snapshots`);
      info.snapshots_total = s?.n || 0;
      info.snapshots_last_at = s?.last_at || null;
    } catch (e) { info.snapshots_error = e.message; }

    // 4. По каждому подписанному складу — сколько snapshot записей.
    try {
      info.snapshots_by_warehouse = await db.all(
        `SELECT warehouse, COUNT(*)::int AS rows, MAX(snapshot_at) AS last_at
         FROM stock_ms_snapshots GROUP BY warehouse`,
      );
    } catch (e) { info.snapshots_by_wh_error = e.message; }

    // 5. Push-подписки: сколько активных на устройствах.
    try {
      const p = await db.get(`SELECT COUNT(*)::int AS n FROM push_subscriptions`);
      info.push_subscriptions_total = p?.n || 0;
    } catch (e) { info.push_error = e.message; }

    // 6. VAPID.
    info.vapid_public_configured = !!process.env.VAPID_PUBLIC_KEY;
    info.vapid_private_configured = !!process.env.VAPID_PRIVATE_KEY;

    // 7. MS token in env.
    info.ms_token_env_present = !!process.env.MOYSKLAD_TOKEN;

    // 8. Уведомления по типу stock.* за последние сутки — сколько записано в notifications.
    try {
      info.recent_stock_notifications = await db.all(
        `SELECT type, COUNT(*)::int AS n, MAX(created_at) AS last_at
         FROM notifications
         WHERE type LIKE 'stock.%' AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY type`,
      );
    } catch (e) { info.recent_notif_error = e.message; }

    // 9. Cron URL для проверки — можно ли дёрнуть stock-diff вручную.
    info.cron_manual_url = '/api/cron/stock-diff';
    info.hint = 'Открой /api/cron/stock-diff в браузере — вернёт JSON с ok/first_run/movements. Первый прогон только сохраняет снапшот (не шлёт push). Второй уже сравнивает.';

    res.json(info);
  }),
);

export default router;
