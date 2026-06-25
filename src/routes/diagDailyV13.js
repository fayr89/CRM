// TEMP: диагностический эндпоинт для AI daily run 2026-06-25-v13 — УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();
const SECRET = 'aiday-v13-Qp7Ws2nL';

function guard(req, res) {
  if (req.query.secret !== SECRET) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// GET /api/diag/daily-v13/data — вернуть все proposals + feedback с тредами
router.get('/data', async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;

    const proposals = await db.all(`
      SELECT p.*, u.name AS admin_decision_by_name,
             f.subject AS feedback_subject, f.status AS feedback_status
      FROM ai_proposals p
      LEFT JOIN users u ON u.id = p.admin_decision_by
      LEFT JOIN feedback f ON f.id = p.feedback_id
      ORDER BY p.created_at DESC
    `);

    const proposalMessages = await db.all(`
      SELECT m.* FROM ai_proposal_messages m
      INNER JOIN ai_proposals p ON p.id = m.proposal_id
      ORDER BY m.created_at ASC, m.id ASC
    `);

    const feedback = await db.all(`
      SELECT f.*, u.name AS user_name_from_users, u.email AS user_email, u.role AS user_role,
             r.name AS resolved_by_name
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN users r ON r.id = f.resolved_by
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY
        (CASE f.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END),
        f.created_at DESC
    `);

    const feedbackMessages = await db.all(`
      SELECT fm.* FROM feedback_messages fm
      INNER JOIN feedback f ON f.id = fm.feedback_id
      WHERE f.status IN ('open', 'awaiting_approval', 'in_progress')
      ORDER BY fm.created_at ASC, fm.id ASC
    `);

    res.json({ adminId, proposals, proposalMessages, feedback, feedbackMessages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/diag/daily-v13/batch — выполнить все операции обхода 2026-06-25-v13
router.get('/batch', async (req, res) => {
  if (!guard(req, res)) return;
  const log = [];
  try {
    const adminUser = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
    const adminId = adminUser?.id || null;

    // === FB#35: новый запрос Ангелины — автозаполнение "Сумма транзакции" ===
    const prop35Title = 'Комиссия в заказе: Сумма транзакции — автозаполнение из суммы заказа + read-only';
    const existing35 = await db.get(
      `SELECT id FROM ai_proposals WHERE title = ? AND status != 'done'`,
      prop35Title,
    );
    let proposalId35;
    if (existing35) {
      proposalId35 = existing35.id;
      log.push(`proposal for FB#35 already exists: #${proposalId35}`);
    } else {
      const summary35 =
        `Ангелина (feedback #35) прислала новое уточнение к блоку комиссии в форме заказа.\n\n` +
        `Текущий вид: блок из 4 полей (Сумма транзакции / Комиссия % / Комиссия Р / Сумма с комиссией). ` +
        `Поле «Сумма транзакции» сейчас редактируемое и не заполняется автоматически — менеджер вводит вручную.\n\n` +
        `Запрошенное изменение:\n` +
        `• Поле «Сумма транзакции» должно автоматически подставляться = сумма всех позиций заказа.\n` +
        `• Обновляться при каждом изменении состава товаров в форме заказа.\n` +
        `• Поле должно быть read-only (нельзя редактировать вручную).\n` +
        `• Пример: заказ #595 на 8396 руб → Сумма транзакции = 8396 автоматически.\n\n` +
        `Что нужно сделать:\n` +
        `— views.js: в openOrderForm найти место, где пересчитывается итог заказа (при добавлении товара). ` +
        `Добавить синхронизацию: commissionSaleI.value = orderTotal (в рублях). Сделать поле disabled/readOnly.\n` +
        `— Пересчёт при открытии формы существующего заказа: заполнять из order.total_amount.\n\n` +
        `Риски: средний — затрагивает блок комиссии (деньги), но изменения только фронтенд (views.js), ` +
        `бэкенд и схема БД не меняются. Если total_amount считается из items, нужно убедиться что ` +
        `синхронизируемое значение корректно (без скидок / с НДС?). Оценка: ~1 час.`;
      const pc35 = [
        { file: 'public/js/views.js', action: 'openOrderForm: auto-sync commissionSaleI = orderTotal on items change; make it readOnly', reason: 'auto-fill Сумма транзакции from order total' },
      ];
      const r35 = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        35, prop35Title, summary35, 'ui-tweak', 'medium',
        'daily-run-2026-06-25-v13', JSON.stringify(pc35),
      );
      proposalId35 = r35.lastInsertRowid;
      log.push(`created proposal #${proposalId35} for FB#35`);
    }

    // Отправить ответ в тред FB#35 (только если последнее сообщение не от AI)
    const lastMsg35 = await db.get(
      `SELECT user_name FROM feedback_messages WHERE feedback_id = 35 ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    if (lastMsg35 && lastMsg35.user_name === 'AI ассистент') {
      log.push('FB#35: last msg already from AI, skip reply');
    } else {
      const text35 =
        `Здравствуйте, Ангелина! Получила уточнение: поле «Сумма транзакции» должно ` +
        `автоматически подставляться из суммы заказа и быть недоступным для ручного редактирования.\n\n` +
        `Изменение затрагивает блок комиссии (деньги), поэтому передала задание администратору ` +
        `на одобрение (предложение №${proposalId35}). Реализуем после одобрения.`;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (35, ?, 'AI ассистент', 'admin', ?, NULL::jsonb)`,
        adminId, text35,
      );
      log.push('sent reply to FB#35');
    }

    // === FB#60: запрос на отчёт «товары без прайса» ===
    const prop60Title = 'Отчёт «Товары без прайса»: список проданных позиций без текущего прайса';
    const existing60 = await db.get(
      `SELECT id FROM ai_proposals WHERE title = ? AND status != 'done'`,
      prop60Title,
    );
    let proposalId60;
    if (existing60) {
      proposalId60 = existing60.id;
      log.push(`proposal for FB#60 already exists: #${proposalId60}`);
    } else {
      const summary60 =
        `Ангелина (feedback #60) просит выдать список позиций, которые продавались, ` +
        `но у которых на данный момент нет прайса.\n\n` +
        `Формат: экспорт в Excel (CSV).\n` +
        `Колонки: Артикул | Наименование | Продавец | Номер заказа | Цена продажи за 1 шт.\n\n` +
        `Определение «нет прайса»: товар присутствует в позициях заказов, но не имеет строки ` +
        `в product_prices (marketplace='Общий прайс', warehouse=warehouse заказа).\n\n` +
        `Что нужно сделать:\n` +
        `— Вариант A (одноразовый): добавить кнопку/ссылку в раздел «Товары» или «Аналитика» → ` +
        `скачать CSV. Реализуется через новый эндпоинт GET /api/products/no-price-report.csv.\n` +
        `— Вариант B (постоянный): раздел/фильтр в каталоге «Без прайса».\n\n` +
        `Запрос: SELECT DISTINCT p.sku, p.name, u.name AS seller, o.id AS order_id, oi.price ` +
        `FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id ` +
        `JOIN users u ON u.id=o.manager_id ` +
        `WHERE NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id=p.id AND pp.marketplace='Общий прайс')\n\n` +
        `Риски: низкий — только чтение. Оценка: ~1 час для CSV-эндпоинта.`;
      const pc60 = [
        { file: 'src/routes/products.js', action: 'add GET /no-price-report.csv endpoint: join order_items+orders+products LEFT JOIN product_prices, filter WHERE no price row exists', reason: 'CSV report of sold items without price' },
        { file: 'public/js/views.js', action: 'add download button in renderProducts for admin role', reason: 'UI access to report' },
      ];
      const r60 = await db.run(
        `INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
        60, prop60Title, summary60, 'feature', 'low',
        'daily-run-2026-06-25-v13', JSON.stringify(pc60),
      );
      proposalId60 = r60.lastInsertRowid;
      log.push(`created proposal #${proposalId60} for FB#60`);
    }

    // Отправить ответ в тред FB#60 (0 сообщений — первый ответ AI)
    const lastMsg60 = await db.get(
      `SELECT user_name FROM feedback_messages WHERE feedback_id = 60 ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    if (lastMsg60 && lastMsg60.user_name === 'AI ассистент') {
      log.push('FB#60: last msg already from AI, skip reply');
    } else {
      const text60 =
        `Здравствуйте, Ангелина! Запрос получен — список проданных товаров без текущего прайса, ` +
        `в формате Excel (артикул, наименование, продавец, номер заказа, цена за шт).\n\n` +
        `Это новая функция (отчёт), поэтому передала задание администратору на одобрение ` +
        `(предложение №${proposalId60}). После одобрения реализуем выгрузку.`;
      await db.run(
        `INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text, attachments)
         VALUES (60, ?, 'AI ассистент', 'admin', ?, NULL::jsonb)`,
        adminId, text60,
      );
      log.push('sent reply to FB#60');
    }

    res.json({ ok: true, proposalId35, proposalId60, log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
