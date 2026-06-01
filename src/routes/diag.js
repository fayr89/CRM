// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '11c27a4be91c20f4b37b91d320389c791c9300a17b432375';
const TEXT = '🔔 Подключите МАХ-уведомления! В профиле «👤 Мой профиль» нажмите «Подключить МАХ» — получайте важные события (заказы, платежи, обращения) сразу в мессенджер. Можно выбрать какие типы получать.';

router.get(
  '/seed-max-banner',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    const existing = await db.get(
      `SELECT id FROM notice_banners WHERE text = ? AND NOW() BETWEEN starts_at AND ends_at LIMIT 1`,
      TEXT,
    );
    if (existing) return res.json({ skipped: 'already exists', id: existing.id });
    const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`);
    const r = await db.run(
      `INSERT INTO notice_banners (text, kind, ends_at, dismissible, created_by)
       VALUES (?, 'info', NOW() + INTERVAL '7 days', TRUE, ?) RETURNING id`,
      TEXT, admin?.id || null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);

export default router;
