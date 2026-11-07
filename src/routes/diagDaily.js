// ВРЕМЕННО: одноразовая запись для ежедневного обхода (идемпотентно). Будет удалён.
import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
const router = Router();
router.get('/seed-67', asyncHandler(async (req, res) => {
  if (req.query.s !== 'RPgc5KOExppGjWmTuFcqVP') return res.status(404).json({ error: 'not found' });
  const ex = await db.get('SELECT id FROM ai_proposals WHERE feedback_id = 67');
  if (ex) return res.json({ already: ex.id });
  const summary = 'Что просит автор (Анастасия): уведомления о поступивших и особенно о ЗАКАНЧИВАЮЩИХСЯ товарах — чтобы на Авито не продавать то, чего уже нет (заказы на товары с нулевым остатком).\n\nЧто предлагаю: (1) порог «мало» — задаётся в карточке товара или один общий (например, ≤3 шт); (2) когда остаток по складу падает до порога или до 0 — уведомление в колокольчик CRM (и push, если включён) менеджерам, подписанным на склад; (3) отдельное уведомление о поступлении (был 0 → стало >0). Часть механики уже есть: фича «Уведомления по складам» (cron stock-diff), но по предложению #67 она сейчас не доходит до конца из-за таймаута 60с — поэтому сначала нужно решить #67, иначе новые уведомления тоже не будут приходить.\n\nРиски: новая сущность/настройки (порог), нагрузка на cron остатков и возможный шум в уведомлениях; деньги и данные не затрагиваются. Сначала нужно уточнить у автора порог и кому слать — задам вопросы в треде после вашего решения.\n\nОценка: 4-6 часов после починки cron stock-diff (#67).';
  const changes = JSON.stringify([
    { file: 'src/routes/cron.js', action: 'edit', reason: 'в stock-diff добавить события «заканчивается»/«поступил» по порогу' },
    { file: 'src/db.js', action: 'edit', reason: 'идемпотентное поле low_stock_threshold (SCHEMA_VERSION-бамп)' },
    { file: 'public/js/views.js', action: 'edit', reason: 'поле порога в карточке товара, тексты уведомлений' }
  ]);
  const p = await db.get("INSERT INTO ai_proposals (feedback_id, title, summary, category, risk, source, proposed_changes, status) VALUES (67, ?, ?, 'feature', 'medium', 'feedback-#67 daily-run-2026-11-07', ?::jsonb, 'pending') RETURNING id", ['Уведомления о заканчивающихся и поступивших товарах', summary, changes]);
  const text = 'Здравствуйте, Анастасия! Вы просите уведомления о поступивших и особенно о заканчивающихся товарах, чтобы не принимать заказы на Авито на товары с нулевым остатком. Это новая функция (настройки порога и уведомления), поэтому я передал её администратору на одобрение (предложение №' + p.id + '). Как решит — вернусь с вопросами или сообщу, что сделано.';
  await db.run("INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (67, NULL, 'AI ассистент', 'admin', ?)", [text]);
  res.json({ proposal: p.id });
}));
export default router;
