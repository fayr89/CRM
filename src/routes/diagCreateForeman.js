// ВРЕМЕННЫЙ diag-endpoint — создать тест-пользователя «Начальник цеха».
// Идемпотентный: если пользователь с email уже есть, обновляет пароль и роль.
// После использования — снести отдельным коммитом (файл + маунт в app.js).

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

const SECRET_KEY = 'foreman-setup-2026-a9k4';
const FOREMAN_EMAIL = 'foreman@iitit.ru';
const FOREMAN_PASSWORD = 'Foreman!2026';
const FOREMAN_NAME = 'Начальник производства';

router.get(
  '/create-foreman-v1',
  asyncHandler(async (req, res) => {
    if (req.query.key !== SECRET_KEY) return res.status(401).json({ error: 'bad key' });
    const hash = bcrypt.hashSync(FOREMAN_PASSWORD, 10);
    // ON CONFLICT (email) — обновляем пароль/роль/имя, оставляем существующего.
    const existing = await db.get(`SELECT id, active FROM users WHERE email = ?`, FOREMAN_EMAIL);
    let userId, action;
    if (existing) {
      await db.run(
        `UPDATE users SET password_hash = ?, name = ?, role = 'foreman', active = TRUE, updated_at = NOW() WHERE id = ?`,
        hash, FOREMAN_NAME, existing.id,
      );
      userId = existing.id;
      action = 'updated';
    } else {
      const r = await db.get(
        `INSERT INTO users (email, password_hash, name, role, active)
         VALUES (?, ?, ?, 'foreman', TRUE)
         RETURNING id`,
        FOREMAN_EMAIL, hash, FOREMAN_NAME,
      );
      userId = r.id;
      action = 'created';
    }
    res.json({
      ok: true,
      action,
      user_id: userId,
      credentials: {
        url_primary: 'https://crm.iitit.ru',
        url_alternate: 'https://crm-orcin-six.vercel.app',
        email: FOREMAN_EMAIL,
        password: FOREMAN_PASSWORD,
        role: 'foreman',
        name: FOREMAN_NAME,
      },
      next_step: 'Открой любую из URL, войди, смени пароль в «Мой профиль → Смена пароля».',
    });
  }),
);

export default router;
