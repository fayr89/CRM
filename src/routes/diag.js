// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();
const SECRET = '1e66fc45ddba22eaab8ea22a681ce75551de44e67faa3e27';
const TEXT = 'Внимание, сайт доступен без ВПН, если у вас нет доступа, свяжитесь с Дмитрием';

router.get(
  '/seed-banner',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });
    // Идемпотентность: если такой текст уже есть и активен — не дублируем.
    const existing = await db.get(
      `SELECT id FROM notice_banners WHERE text = ? AND NOW() BETWEEN starts_at AND ends_at LIMIT 1`,
      TEXT,
    );
    if (existing) return res.json({ skipped: 'already exists', id: existing.id });
    const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`);
    const r = await db.run(
      `INSERT INTO notice_banners (text, kind, ends_at, dismissible, created_by)
       VALUES (?, 'warning', NOW() + INTERVAL '3 days', TRUE, ?) RETURNING id`,
      TEXT, admin?.id || null,
    );
    res.json({ ok: true, id: r.lastInsertRowid });
  }),
);

export default router;
