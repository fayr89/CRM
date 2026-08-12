// Настройки уведомлений: какие типы юзер хочет получать в МАХ.
// Отсутствие записи = включено (default on). Запись с enabled=false = выключено.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { NOTIFICATION_TYPES, notificationTypeRelevantForRole } from '../services/notification-types.js';

const router = Router();

router.use(authenticate);

// GET /api/notification-types — список всех типов (для админа: справочник + шаблоны).
router.get(
  '/types',
  asyncHandler(async (_req, res) => {
    res.json({ data: NOTIFICATION_TYPES });
  }),
);

// GET /api/me/notification-prefs — настройки текущего пользователя.
// Возвращаем все типы, актуальные для его роли, с флагом enabled.
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT notification_type, enabled FROM user_notification_prefs WHERE user_id = ?`,
      req.user.id,
    );
    const stored = new Map(rows.map((r) => [r.notification_type, r.enabled]));
    const data = NOTIFICATION_TYPES
      .filter((t) => notificationTypeRelevantForRole(t.key, req.user.role))
      .map((t) => ({
        key: t.key,
        label: t.label,
        description: t.description,
        template: t.template,
        group: t.group || 'Общее',
        // Default = true (если записи нет — включено).
        enabled: stored.has(t.key) ? stored.get(t.key) : true,
      }));
    res.json({ data });
  }),
);

const updateSchema = z.object({
  prefs: z.array(z.object({
    key: z.string().min(1),
    enabled: z.boolean(),
  })),
});

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const { prefs } = updateSchema.parse(req.body || {});
    const validKeys = new Set(NOTIFICATION_TYPES.map((t) => t.key));
    for (const p of prefs) {
      if (!validKeys.has(p.key)) continue;
      await db.run(
        `INSERT INTO user_notification_prefs (user_id, notification_type, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id, notification_type)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        req.user.id, p.key, p.enabled,
      );
    }
    res.json({ ok: true });
  }),
);

export default router;
