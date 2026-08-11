// ВРЕМЕННЫЙ diag-эндпоинт для разовой загрузки базы «Базы отдыха НСО и Алтай».
// Без auth (защита — уникальность имени кампании: повторный вызов ничего не сделает).
// GET /api/diag/import-nso-altay-v1?key=nso-alt-2026-08-11-x9k2
// После первого успешного вызова этот файл + маунт в app.js + _nsoAltaySeed.js — СНЕСТИ.

import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';
import { CONTACTS } from './_nsoAltaySeed.js';

const router = Router();
const SECRET_KEY = 'nso-alt-2026-08-11-x9k2';
const CAMPAIGN_NAME = 'Базы отдыха НСО и Алтай';

function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

router.get(
  '/import-nso-altay-v1',
  asyncHandler(async (req, res) => {
    if (req.query.key !== SECRET_KEY) return res.status(401).json({ error: 'bad key' });

    // Идемпотентность: если кампания с таким именем есть — ничего не делаем.
    const existing = await db.get(`SELECT id FROM calling_campaigns WHERE name = ?`, CAMPAIGN_NAME);
    let campaignId;
    let campaignCreated = false;

    if (existing) {
      campaignId = existing.id;
    } else {
      const created = await db.get(
        `INSERT INTO calling_campaigns
          (name, type, status, description, required_points, source, target_calls_per_day)
         VALUES (?, 'production_order', 'active', ?, ?::jsonb, ?, 30)
         RETURNING id`,
        CAMPAIGN_NAME,
        [
          'ПРОДУКТ: напольные вешалки для баз отдыха и отелей, отгрузка из Новосибирска.',
          '',
          'ЛПР ПО ТИПАМ:',
          '• До 20 номеров (C) — собственник, часто сам берёт трубку.',
          '• 20-60 номеров (B) — управляющий / директор базы.',
          '• 60+ номеров, сети, курорты (A) — АХО / снабжение + согласование управляющего.',
          '',
          'ПОДГОТОВКА (2 мин): сайт → ИНН → Rusprofile/ЗачестныйБизнес → ФИО директора → звонить по имени.',
          '',
          'ОБХОД РЕСЕПШНА:',
          '«Добрый день, это <имя>, компания <название>, Новосибирск. По вопросу оснащения номеров. <Имя Отчество> сейчас на месте — или у вас закупкой мебели кто-то другой занимается?»',
          '',
          'ПЕРВАЯ ФРАЗА ЛПР (боль, не товар):',
          '«В отзывах на картах у баз вашего формата регулярно всплывает — гостям некуда повесить верхнюю одежду, вещи лежат в сумках у двери. Мы делаем напольные вешалки под домики и номера, отгружаем из Новосибирска. Скинуть фото и цены на WhatsApp?»',
          '',
          'СЕЗОН: апр-май и окт-ноя — окно закупок. Июль-август на Алтае — ЛПР в операционке.',
          'ЛУЧШЕЕ ВРЕМЯ: будни 10-12 и 15-17 по местному (МСК+4).',
          '',
          'СРЕДНИЙ ЧЕК: комплект = число домиков × 1-2 шт. У A-объектов от 30 до 200+ единиц размещения.',
          '',
          'ПРИОРИТЕТЫ: A = 150+ отзывов на картах • B = 50-149 • C = <50. Точное число уточняется на звонке.',
        ].join('\n'),
        JSON.stringify([
          'Уточнить количество домиков / номеров',
          'Определить ЛПР по типу объекта (собственник / управляющий / АХО)',
          'Взять WhatsApp для отправки фото и цен',
          'Уточнить окно закупок (сезон)',
        ]),
        'Google Maps карточки, 06.08.2026',
      );
      campaignId = created.id;
      campaignCreated = true;
    }

    // Готовим лиды (нормализация телефона, приоритета).
    const prepared = [];
    const seen = new Set();
    for (const raw of CONTACTS) {
      const phone = normalizePhone(raw.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      let priority = null;
      if (raw.priority) {
        const p = String(raw.priority).toUpperCase();
        if (p === 'A' || p === 'B' || p === 'C') priority = p;
      }
      prepared.push({
        first_name: (raw.company_name || 'Без имени').slice(0, 200),
        company_name: (raw.company_name || null),
        phone,
        region: raw.region || null,
        city: raw.city || null,
        industry: raw.industry || null,
        size_hint: raw.size_hint || null,
        description: raw.description || null,
        priority,
      });
    }

    // Проверяем какие phones уже есть в этой кампании — не вставляем повторно.
    const existingPhones = await db.all(
      `SELECT phone FROM leads WHERE campaign_id = ? AND phone = ANY(?::text[])`,
      campaignId, prepared.map((r) => r.phone),
    );
    const alreadyIn = new Set(existingPhones.map((r) => r.phone));
    const toInsert = prepared.filter((r) => !alreadyIn.has(r.phone));

    // Батч-вставка.
    let inserted = 0;
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of chunk) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'cold_call', 'new')`);
        params.push(
          r.first_name, r.company_name, r.phone, r.region, r.city,
          r.industry, r.size_hint, r.description, r.priority, campaignId,
        );
      }
      const sql = `
        INSERT INTO leads
          (first_name, company_name, phone, region, city, industry, size_hint, description, priority, campaign_id, source, status)
        VALUES ${values.join(', ')}
      `;
      await db.run(sql, ...params);
      inserted += chunk.length;
    }

    // Итоги по приоритетам.
    const byPri = await db.all(
      `SELECT COALESCE(priority, '?') AS priority, COUNT(*)::int AS n
       FROM leads WHERE campaign_id = ? GROUP BY 1 ORDER BY 1`,
      campaignId,
    );

    res.json({
      ok: true,
      campaign_id: campaignId,
      campaign_created: campaignCreated,
      contacts_in_seed: CONTACTS.length,
      already_in_campaign: alreadyIn.size,
      inserted_now: inserted,
      total_in_campaign_by_priority: byPri,
      next_step: 'Открой CRM → Обзвон → Кампании, распредели на менеджеров.',
    });
  }),
);

export default router;
