// TEMPORARY DIAG — daily AI run v14 — DELETE AFTER USE
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'dr14-mN8rT2kX5pL';

function guard(req, res) {
  if (req.query.secret !== SECRET) { res.status(403).json({ error: 'forbidden' }); return false; }
  return true;
}

router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;

    if (op === 'proposals') {
      const st = req.query.status;
      const rows = st
        ? await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status, f.user_id AS feedback_user_id FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`,
            st,
          )
        : await db.all(
            `SELECT p.*, f.subject AS feedback_subject, f.status AS feedback_status FROM ai_proposals p LEFT JOIN feedback f ON f.id = p.feedback_id ORDER BY p.created_at DESC LIMIT 100`,
          );
      return res.json({ data: rows });
    }

    if (op === 'feedback') {
      const rows = await db.all(
        `SELECT f.*, u.name AS user_name, u.email AS user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC LIMIT 200`,
      );
      const result = [];
      for (const fb of rows) {
        const msgs = await db.all(
          `SELECT id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ? ORDER BY created_at ASC, id ASC`,
          fb.id,
        );
        result.push({ ...fb, thread: msgs });
      }
      return res.json({ data: result });
    }

    // Preset: создать proposal для FB#16 (цены Авито)
    if (op === 'create-proposal-fb16') {
      const existing = await db.all(`SELECT id FROM ai_proposals WHERE feedback_id = 16 AND status = 'pending'`);
      if (existing.length > 0) {
        return res.json({ ok: false, msg: 'proposal already exists', ids: existing.map(r => r.id) });
      }
      const summary = `Владимир Панов (FB#16) прикрепил файл «Цены авито 1.txt» с ~54 артикулами и ценами. Просит установить эти цены в CRM как «цены по умолчанию для Авито».

Файл содержит колонки: Артикул | Наименование | НОВЫЕ ЦЕНЫ (числа с иногда «₽» или «,»).
Примеры: арт. 70365360 → 1299 руб, 365368 → 1999 руб, 466287 → 289 руб.
1 строка без артикула («Подножка НОВАЯ») — пропустить.

Что нужно сделать:
1) Для каждой строки с артикулом: UPSERT в product_prices (marketplace='Общий прайс', warehouse=<первый из app_settings.warehouses.all>) с новой ценой.
2) Сопоставление: products.external_id = артикул из файла.
3) После — написать Владимиру: сколько позиций обновлено, сколько артикулов не нашлось.

Важно:
- marketplace ВСЕГДА = 'Общий прайс' (не 'Avito') — согласно SCHEMA_VERSION 19.
- Цены: нормализовать «₽», «,» → «.», пробелы.
- Склад: уточнить у владельца (Dmitrii) — какой warehouse использовать, т.к. это влияет на отображение при создании заказа.

Риск: HIGH — изменение прайсовых данных. Перед выполнением подтвердить warehouse с владельцем.
Оценка: 30–60 мин (diag-эндпоинт + SQL UPSERT).`;
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        16,
        'Установить цены Авито (~54 арт.) по файлу из FB#16 (Владимир)',
        summary,
        'business-logic',
        'high',
        'daily-run-2026-06-04-v14',
        JSON.stringify([
          { file: 'diag-endpoint (временный)', action: 'UPSERT product_prices для ~54 артикулов из файла FB#16' },
        ]),
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const { op } = req.query;
    const b = req.body || {};

    if (op === 'patch-proposal') {
      await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, b.decision, b.id);
      return res.json({ ok: true });
    }

    if (op === 'post-msg') {
      const r = await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, NULL, 'AI ассистент', 'admin', ?) RETURNING id`,
        b.feedback_id, b.text,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    if (op === 'patch-feedback') {
      const { id, status, admin_reply } = b;
      const fields = [];
      const vals = [];
      if (status) { fields.push('status = ?'); vals.push(status); }
      if (admin_reply) { fields.push('admin_reply = ?'); vals.push(admin_reply); }
      if (!fields.length) return res.status(400).json({ error: 'nothing to update' });
      fields.push('updated_at = NOW()');
      await db.run(`UPDATE feedback SET ${fields.join(', ')} WHERE id = ?`, ...vals, id);
      return res.json({ ok: true });
    }

    if (op === 'create-proposal') {
      const r = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        b.feedback_id ?? null, b.title, b.summary,
        b.category ?? null, b.risk || 'medium', b.source ?? null,
        b.proposed_changes ? JSON.stringify(b.proposed_changes) : null,
      );
      return res.json({ ok: true, id: r.lastInsertRowid });
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
