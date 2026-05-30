// ВРЕМЕННЫЙ диагностический эндпоинт. Сносится сразу после использования.
// Постит уточняющий вопрос в обращение #11.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { notify } from '../services/notifications.js';

const router = Router();
const SECRET = 'b860af5a8dc274ffd27b55d84c3385072b124e3da98f89db';

const TEXT = `Здравствуйте, Владимир! Спасибо за обратную связь — фича полезная. Чтобы я сделал её правильно, нужны ваши ответы:

1) Какой формат файла удобнее — Excel (.xlsx) или CSV (открывается тем же Excel'ем, но проще для нас)?
2) Колонки в файле. Какой минимальный набор должен быть, чтобы заказ создался? Я предлагаю такой (отметьте, что обязательно, что лишнее, что добавить):
   • Артикул товара
   • Количество
   • Цена за штуку
   • Маркетплейс (Wildberries / Ozon / Avito / …)
   • Имя клиента
   • Телефон клиента (опционально)
   • Способ оплаты (Карта / Наличные / Перевод)
   • Способ доставки (Почта / СДЭК / Авито-доставка / …)
   • Трек-номер (опционально на этапе создания)
   • Заметка
3) Что делать если в файле артикул, которого нет в каталоге — пропустить строку с предупреждением или создать заказ с ручной позицией?
4) Один файл — один заказ или каждая строка = отдельный заказ (если 50 клиентов в Avito — 50 строк)? А может быть «группировать по клиенту/телефону»?
5) Куда удобнее загружать — на странице «Продажи с площадок» рядом с кнопкой «+ Новый заказ», или отдельный раздел «Импорт»?
6) Нужно ли превью перед окончательной загрузкой (показать таблицу «вот эти 30 строк станут заказами, в 2 строках ошибки — поправьте»)?

Идеально, если пришлёте пример файла как вы себе это представляете — даже черновик в Excel'е, 3-4 строки. Тогда подгоню формат под вас.`;

router.get(
  '/seed-q11',
  asyncHandler(async (req, res) => {
    if (req.query.token !== SECRET) return res.status(404).json({ error: 'not found' });

    const admin = await db.get(
      `SELECT id, name FROM users WHERE role = 'admin' AND active = TRUE ORDER BY id LIMIT 1`,
    );
    if (!admin) return res.status(500).json({ error: 'no admin user found' });

    const fb = await db.get('SELECT id, user_id, subject FROM feedback WHERE id = 11');
    if (!fb) return res.status(404).json({ error: 'feedback #11 not found' });

    const existing = await db.get(
      `SELECT id FROM feedback_messages WHERE feedback_id = 11 AND role = 'admin' AND length(text) > 100 LIMIT 1`,
    );
    if (existing) return res.json({ skipped: 'already seeded' });

    const r = await db.run(
      `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, 'admin', ?) RETURNING id`,
      fb.id, admin.id, admin.name, TEXT,
    );
    try {
      if (fb.user_id) {
        await notify(
          fb.user_id, 'feedback.message',
          `💬 Вопрос по обращению: ${fb.subject}`,
          TEXT.slice(0, 300), '#/my-feedback',
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[diag q11] notify:', e.message);
    }
    res.json({ ok: true, message_id: r.lastInsertRowid });
  }),
);

export default router;
