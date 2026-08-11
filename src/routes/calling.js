// Модуль обзвона. Кампании + распределение лидов + мои задачи + попытки + статистика.
//
// Модель:
//   calling_campaigns — кампания (кто ищет, что продаём).
//   leads (расширенные полями campaign_id, qualification, next_call_at) — записи базы.
//   call_attempts — каждый факт разговора.
//
// Правила видимости:
//   admin/rop — все кампании и все лиды.
//   manager/sales — только свои лиды из активных кампаний, при наличии is_active_caller.
//
// Разделяющая роль-проверка — на уровне UI-меню; API проверяет владельца лида отдельно.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();
router.use(authenticate);

const CAMPAIGN_TYPES = ['production_order', 'product_sales'];
const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'closed'];
const OUTCOMES = ['no_answer', 'not_interested', 'callback', 'qualified', 'meeting_scheduled', 'converted', 'dead'];

const campaignSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(CAMPAIGN_TYPES).default('production_order'),
  status: z.enum(CAMPAIGN_STATUSES).default('active'),
  description: z.string().optional().nullable(),
  required_points: z.array(z.string().min(1)).default([]),
  source: z.string().optional().nullable(),
  default_project_id: z.number().int().positive().optional().nullable(),
  target_calls_per_day: z.number().int().min(0).max(1000).default(30),
});

// Только тот, кому админ разрешил, может участвовать в обзвоне (кроме админа/ропа).
function requireCallerAccess(req) {
  const u = req.user;
  if (u.role === 'admin' || u.role === 'rop') return;
  if (!u.is_active_caller) throw Forbidden('Обзвон доступен только активным менеджерам обзвона.');
}

function requireCampaignAdmin(req) {
  if (req.user.role !== 'admin' && req.user.role !== 'rop') {
    throw Forbidden('Только админ или РОП управляют кампаниями обзвона.');
  }
}

// ============ КАМПАНИИ ============

// Список кампаний. Для админа/ропа — все, для менеджера — только те, в которых у него есть лиды.
router.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const u = req.user;
    const isAdmin = u.role === 'admin' || u.role === 'rop';
    let sql, params;
    if (isAdmin) {
      sql = `
        SELECT c.*,
               (SELECT COUNT(*)::int FROM leads l WHERE l.campaign_id = c.id) AS leads_total,
               (SELECT COUNT(*)::int FROM leads l WHERE l.campaign_id = c.id AND l.qualification IS NULL) AS leads_untouched,
               (SELECT COUNT(*)::int FROM leads l WHERE l.campaign_id = c.id AND l.qualification = 'converted') AS leads_converted
        FROM calling_campaigns c
        ORDER BY c.status = 'active' DESC, c.created_at DESC
      `;
      params = [];
    } else {
      requireCallerAccess(req);
      sql = `
        SELECT c.*,
               (SELECT COUNT(*)::int FROM leads l WHERE l.campaign_id = c.id AND l.owner_id = ?) AS leads_total,
               (SELECT COUNT(*)::int FROM leads l WHERE l.campaign_id = c.id AND l.owner_id = ? AND l.qualification IS NULL) AS leads_untouched
        FROM calling_campaigns c
        WHERE c.status = 'active' AND EXISTS (
          SELECT 1 FROM leads l WHERE l.campaign_id = c.id AND l.owner_id = ?
        )
        ORDER BY c.created_at DESC
      `;
      params = [u.id, u.id, u.id];
    }
    const rows = await db.all(sql, ...params);
    res.json({ campaigns: rows });
  }),
);

router.post(
  '/campaigns',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const data = campaignSchema.parse(req.body || {});
    const result = await db.get(
      `INSERT INTO calling_campaigns
        (name, type, status, description, required_points, source, default_project_id, target_calls_per_day, created_by)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?)
       RETURNING *`,
      data.name, data.type, data.status, data.description || null,
      JSON.stringify(data.required_points), data.source || null,
      data.default_project_id || null, data.target_calls_per_day, req.user.id,
    );
    await logAction(req, {
      action: 'calling.campaign_created',
      entity_type: 'calling_campaign', entity_id: result.id,
      details: { name: result.name, type: result.type },
    });
    res.status(201).json(result);
  }),
);

router.get(
  '/campaigns/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const c = await db.get(`SELECT * FROM calling_campaigns WHERE id = ?`, id);
    if (!c) throw NotFound('Кампания не найдена');
    // Менеджер видит кампанию, только если в ней есть его лиды.
    if (req.user.role !== 'admin' && req.user.role !== 'rop') {
      requireCallerAccess(req);
      const own = await db.get(
        `SELECT 1 FROM leads WHERE campaign_id = ? AND owner_id = ? LIMIT 1`,
        id, req.user.id,
      );
      if (!own) throw Forbidden('Кампания не назначена вам.');
    }
    res.json(c);
  }),
);

router.patch(
  '/campaigns/:id',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const id = Number(req.params.id);
    const c = await db.get(`SELECT * FROM calling_campaigns WHERE id = ?`, id);
    if (!c) throw NotFound('Кампания не найдена');
    const data = campaignSchema.partial().parse(req.body || {});
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'required_points') { sets.push(`${k} = ?::jsonb`); params.push(JSON.stringify(v)); }
      else { sets.push(`${k} = ?`); params.push(v); }
    }
    if (!sets.length) return res.json(c);
    sets.push('updated_at = NOW()');
    params.push(id);
    const upd = await db.get(
      `UPDATE calling_campaigns SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
      ...params,
    );
    await logAction(req, {
      action: 'calling.campaign_updated',
      entity_type: 'calling_campaign', entity_id: id,
      details: { changed: Object.keys(data) },
    });
    res.json(upd);
  }),
);

// ============ ИМПОРТ ============

const importRowSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  inn: z.string().optional().nullable(),
  size_hint: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
}).passthrough();

function normalizePhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (!digits) return null;
  // РФ: приводим 8XXXXXXXXXX и 7XXXXXXXXXX к +7XXXXXXXXXX; иностранное — как есть с +.
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

function normalizeEmail(e) {
  if (!e) return null;
  const s = String(e).trim().toLowerCase();
  return s.includes('@') ? s : null;
}

function normalizeInn(v) {
  if (!v) return null;
  const s = String(v).replace(/\D/g, '');
  return s.length === 10 || s.length === 12 ? s : null;
}

// POST /campaigns/:id/import — принимает { rows: [{first_name, phone, ...}, ...] }
// Возвращает отчёт: added, skipped_duplicate_in_file, skipped_duplicate_in_campaign,
// warnings_duplicate_in_other_campaign (если import_conflict_mode='include' — всё равно добавлены).
router.post(
  '/campaigns/:id/import',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const id = Number(req.params.id);
    const campaign = await db.get(`SELECT * FROM calling_campaigns WHERE id = ?`, id);
    if (!campaign) throw NotFound('Кампания не найдена');

    const body = z.object({
      rows: z.array(importRowSchema).min(1).max(20000),
      conflict_mode: z.enum(['skip', 'include']).default('include'), // старые кампании: 'include' по решению юзера
    }).parse(req.body || {});

    const report = {
      total: body.rows.length,
      added: 0,
      skipped_no_contact: 0,
      skipped_duplicate_in_file: 0,
      skipped_duplicate_in_campaign: 0,
      warnings_duplicate_in_other_campaign: 0,
    };

    // Нормализуем и отбрасываем строки без телефона (телефон — обязателен для обзвона).
    const seenInFile = new Set();
    const prepared = [];
    for (const raw of body.rows) {
      const phone = normalizePhone(raw.phone);
      const email = normalizeEmail(raw.email);
      const inn = normalizeInn(raw.inn);
      if (!phone) { report.skipped_no_contact++; continue; }
      const dedupKey = phone; // основной ключ дедупа — телефон
      if (seenInFile.has(dedupKey)) { report.skipped_duplicate_in_file++; continue; }
      seenInFile.add(dedupKey);
      prepared.push({
        first_name: (raw.first_name || raw.company_name || 'Без имени').toString().slice(0, 200),
        last_name: raw.last_name ? String(raw.last_name).slice(0, 200) : null,
        company_name: raw.company_name ? String(raw.company_name).slice(0, 200) : null,
        phone, email, inn,
        city: raw.city ? String(raw.city).slice(0, 100) : null,
        industry: raw.industry ? String(raw.industry).slice(0, 100) : null,
        website: raw.website ? String(raw.website).slice(0, 300) : null,
        size_hint: raw.size_hint ? String(raw.size_hint).slice(0, 100) : null,
        position: raw.position ? String(raw.position).slice(0, 100) : null,
        description: raw.description ? String(raw.description).slice(0, 2000) : null,
        raw_import_row: raw,
      });
    }
    if (!prepared.length) return res.json(report);

    // Собираем дедуп-множества в один запрос: свои phones этой кампании + чужие phones.
    const phones = prepared.map((r) => r.phone);
    const existing = await db.all(
      `SELECT phone, campaign_id FROM leads WHERE phone = ANY(?::text[])`,
      phones,
    );
    const inThisCampaign = new Set(existing.filter((r) => r.campaign_id === id).map((r) => r.phone));
    const inOtherCampaign = new Set(existing.filter((r) => r.campaign_id !== id).map((r) => r.phone));

    // Вставка. Дефолтный owner — не назначаем, лежит в пуле.
    const toInsert = [];
    for (const r of prepared) {
      if (inThisCampaign.has(r.phone)) { report.skipped_duplicate_in_campaign++; continue; }
      if (inOtherCampaign.has(r.phone)) {
        if (body.conflict_mode === 'skip') { report.skipped_duplicate_in_campaign++; continue; }
        report.warnings_duplicate_in_other_campaign++;
      }
      toInsert.push(r);
    }

    // Батч-вставка.
    const BATCH = 200;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of chunk) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'cold_call', 'new', $${p++}::jsonb)`);
        params.push(
          r.first_name, r.last_name, r.company_name, r.phone, r.email, r.inn,
          r.city, r.industry, r.website, r.size_hint, r.position, r.description,
          id, campaign.default_project_id, JSON.stringify(r.raw_import_row),
        );
      }
      const sql = `
        INSERT INTO leads
          (first_name, last_name, company_name, phone, email, inn,
           city, industry, website, size_hint, position, description,
           campaign_id, project_id, source, status, raw_import_row)
        VALUES ${values.join(', ')}
      `;
      await db.run(sql, ...params);
      report.added += chunk.length;
    }

    await logAction(req, {
      action: 'calling.import',
      entity_type: 'calling_campaign', entity_id: id,
      details: report,
    });
    res.json(report);
  }),
);

// ============ РАСПРЕДЕЛЕНИЕ ============

// POST /campaigns/:id/distribute — round-robin по указанным менеджерам.
// Тело: { manager_ids: [1,2,3], only_unassigned: true }.
router.post(
  '/campaigns/:id/distribute',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const id = Number(req.params.id);
    const body = z.object({
      manager_ids: z.array(z.number().int().positive()).min(1),
      only_unassigned: z.boolean().default(true),
    }).parse(req.body || {});

    // Проверяем что все менеджеры — активные обзвонщики.
    const mgrs = await db.all(
      `SELECT id, is_active_caller FROM users WHERE id = ANY(?::int[]) AND active = TRUE`,
      body.manager_ids,
    );
    const bad = mgrs.filter((m) => !m.is_active_caller).map((m) => m.id);
    if (bad.length) throw BadRequest(`Пользователи не активные обзвонщики: ${bad.join(', ')}`);
    if (mgrs.length !== body.manager_ids.length) {
      throw BadRequest('Некоторые пользователи не найдены или отключены.');
    }

    // Берём лиды без owner (или все — по флагу).
    const leads = body.only_unassigned
      ? await db.all(`SELECT id FROM leads WHERE campaign_id = ? AND owner_id IS NULL ORDER BY id`, id)
      : await db.all(`SELECT id FROM leads WHERE campaign_id = ? ORDER BY id`, id);

    if (!leads.length) return res.json({ distributed: 0, per_manager: {} });

    const perMgr = Object.fromEntries(body.manager_ids.map((mid) => [mid, 0]));
    for (let i = 0; i < leads.length; i++) {
      const mid = body.manager_ids[i % body.manager_ids.length];
      perMgr[mid]++;
    }

    // Батчами обновляем — по каждому менеджеру одним UPDATE ... WHERE id IN (...).
    const assignments = Object.fromEntries(body.manager_ids.map((mid) => [mid, []]));
    for (let i = 0; i < leads.length; i++) {
      const mid = body.manager_ids[i % body.manager_ids.length];
      assignments[mid].push(leads[i].id);
    }
    for (const [mid, ids] of Object.entries(assignments)) {
      if (!ids.length) continue;
      await db.run(`UPDATE leads SET owner_id = ?, updated_at = NOW() WHERE id = ANY(?::int[])`, Number(mid), ids);
    }

    await logAction(req, {
      action: 'calling.distributed',
      entity_type: 'calling_campaign', entity_id: id,
      details: { per_manager: perMgr, total: leads.length, only_unassigned: body.only_unassigned },
    });
    res.json({ distributed: leads.length, per_manager: perMgr });
  }),
);

// ============ МОИ ЗАДАЧИ ============

// GET /my-tasks?campaign_id=&scope=today|callbacks|all
router.get(
  '/my-tasks',
  asyncHandler(async (req, res) => {
    requireCallerAccess(req);
    const uid = req.user.id;
    const campaignId = req.query.campaign_id ? Number(req.query.campaign_id) : null;
    const scope = ['today', 'callbacks', 'all'].includes(req.query.scope) ? req.query.scope : 'today';

    const where = ['l.owner_id = ?', 'l.campaign_id IS NOT NULL', 'c.status = \'active\''];
    const params = [uid];
    if (campaignId) { where.push('l.campaign_id = ?'); params.push(campaignId); }
    if (scope === 'today') {
      where.push('(l.qualification IS NULL OR l.next_call_at IS NULL OR l.next_call_at <= NOW())');
      where.push(`(l.qualification IS NULL OR l.qualification IN ('no_answer','callback'))`);
    } else if (scope === 'callbacks') {
      where.push(`l.qualification = 'callback'`);
    }

    const orderBy = scope === 'callbacks'
      ? 'l.next_call_at ASC NULLS LAST'
      : 'l.next_call_at NULLS FIRST, l.id ASC';

    const rows = await db.all(
      `SELECT l.id, l.first_name, l.last_name, l.company_name, l.phone, l.email,
              l.city, l.industry, l.website, l.qualification, l.next_call_at,
              l.campaign_id, c.name AS campaign_name, c.type AS campaign_type,
              (SELECT MAX(at) FROM call_attempts a WHERE a.lead_id = l.id) AS last_attempt_at,
              (SELECT note FROM call_attempts a WHERE a.lead_id = l.id ORDER BY at DESC LIMIT 1) AS last_note
       FROM leads l
       JOIN calling_campaigns c ON c.id = l.campaign_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT 200`,
      ...params,
    );

    // KPI на сегодня.
    const dayStats = await db.get(
      `SELECT COUNT(*)::int AS calls_today,
              COUNT(*) FILTER (WHERE outcome IN ('qualified','meeting_scheduled','converted'))::int AS wins_today
       FROM call_attempts
       WHERE user_id = ? AND at::date = CURRENT_DATE`,
      uid,
    );
    const capacity = req.user.calling_capacity || 30;

    res.json({
      tasks: rows,
      kpi: {
        calls_today: dayStats.calls_today,
        wins_today: dayStats.wins_today,
        target: capacity,
      },
    });
  }),
);

// GET /leads/:id — карточка лида с историей попыток.
router.get(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const lead = await db.get(
      `SELECT l.*, c.name AS campaign_name, c.type AS campaign_type,
              c.description AS campaign_description, c.required_points AS campaign_required_points
       FROM leads l LEFT JOIN calling_campaigns c ON c.id = l.campaign_id
       WHERE l.id = ?`,
      id,
    );
    if (!lead) throw NotFound('Лид не найден');
    const isAdmin = req.user.role === 'admin' || req.user.role === 'rop';
    if (!isAdmin) {
      requireCallerAccess(req);
      if (lead.owner_id !== req.user.id) throw Forbidden('Лид назначен другому менеджеру.');
    }
    const attempts = await db.all(
      `SELECT a.*, u.name AS user_name
       FROM call_attempts a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.lead_id = ? ORDER BY a.at DESC`,
      id,
    );
    res.json({ lead, attempts });
  }),
);

// ============ ФИКСАЦИЯ ПОПЫТКИ ============

const attemptSchema = z.object({
  outcome: z.enum(OUTCOMES),
  note: z.string().max(2000).optional().nullable(),
  duration_sec: z.number().int().min(0).max(24 * 3600).optional().nullable(),
  next_call_at: z.string().datetime().optional().nullable(),
  covered_points: z.array(z.string()).optional().default([]),
});

router.post(
  '/leads/:id/attempts',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const lead = await db.get(`SELECT * FROM leads WHERE id = ?`, id);
    if (!lead) throw NotFound('Лид не найден');
    const isAdmin = req.user.role === 'admin' || req.user.role === 'rop';
    if (!isAdmin) {
      requireCallerAccess(req);
      if (lead.owner_id !== req.user.id) throw Forbidden('Лид назначен другому менеджеру.');
    }
    const data = attemptSchema.parse(req.body || {});
    // callback без next_call_at не имеет смысла.
    if (data.outcome === 'callback' && !data.next_call_at) {
      throw BadRequest('Для «Перезвонить» укажите дату следующего звонка.');
    }

    // Транзакция: попытка + обновление лида (последний исход + next_call_at).
    const result = await db.withTransaction(async (tx) => {
      const attempt = await tx.get(
        `INSERT INTO call_attempts (lead_id, user_id, outcome, note, duration_sec, next_call_at, covered_points)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING *`,
        id, req.user.id, data.outcome, data.note || null, data.duration_sec || null,
        data.next_call_at || null, JSON.stringify(data.covered_points || []),
      );
      // Обновляем сам лид: qualification = последний outcome; next_call_at — если callback.
      const nextCall = data.outcome === 'callback' ? data.next_call_at : null;
      // Синхронизируем leads.status на переходных исходах — чтоб глобальный список лидов не рассинхронился.
      let statusPatch = '';
      if (data.outcome === 'qualified' || data.outcome === 'meeting_scheduled') statusPatch = ", status = 'qualified'";
      else if (data.outcome === 'not_interested' || data.outcome === 'dead') statusPatch = ", status = 'unqualified'";
      else if (data.outcome === 'converted') statusPatch = ", status = 'converted', converted_at = NOW()";
      await tx.run(
        `UPDATE leads SET qualification = ?, next_call_at = ?, updated_at = NOW() ${statusPatch} WHERE id = ?`,
        data.outcome, nextCall, id,
      );
      return attempt;
    });

    await logAction(req, {
      action: 'calling.attempt',
      entity_type: 'lead', entity_id: id,
      details: { outcome: data.outcome, campaign_id: lead.campaign_id, has_note: !!data.note },
    });
    res.status(201).json(result);
  }),
);

// ============ АНАЛИТИКА ============

// GET /stats/campaign/:id — сводка кампании.
router.get(
  '/stats/campaign/:id',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const id = Number(req.params.id);
    const campaign = await db.get(`SELECT * FROM calling_campaigns WHERE id = ?`, id);
    if (!campaign) throw NotFound('Кампания не найдена');

    const byQualification = await db.all(
      `SELECT COALESCE(qualification, 'not_contacted') AS outcome, COUNT(*)::int AS n
       FROM leads WHERE campaign_id = ? GROUP BY 1 ORDER BY 2 DESC`,
      id,
    );
    const byManager = await db.all(
      `SELECT l.owner_id, u.name AS user_name,
              COUNT(*)::int AS assigned,
              COUNT(*) FILTER (WHERE l.qualification IS NOT NULL)::int AS touched,
              COUNT(*) FILTER (WHERE l.qualification IN ('qualified','meeting_scheduled','converted'))::int AS wins,
              (SELECT COUNT(*)::int FROM call_attempts a
                 JOIN leads l2 ON l2.id = a.lead_id
                 WHERE l2.campaign_id = ? AND a.user_id = l.owner_id) AS attempts
       FROM leads l LEFT JOIN users u ON u.id = l.owner_id
       WHERE l.campaign_id = ? AND l.owner_id IS NOT NULL
       GROUP BY l.owner_id, u.name
       ORDER BY wins DESC, touched DESC`,
      id, id,
    );
    const overdue = await db.get(
      `SELECT COUNT(*)::int AS n FROM leads
       WHERE campaign_id = ? AND qualification = 'callback' AND next_call_at < NOW()`,
      id,
    );
    res.json({ campaign, by_qualification: byQualification, by_manager: byManager, overdue_callbacks: overdue.n });
  }),
);

// GET /stats/managers — производительность обзвонщиков за период (по умолчанию 30д).
router.get(
  '/stats/managers',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const rows = await db.all(
      `SELECT u.id, u.name,
              COUNT(a.id)::int AS attempts_total,
              COUNT(a.id) FILTER (WHERE a.outcome = 'no_answer')::int AS no_answer,
              COUNT(a.id) FILTER (WHERE a.outcome IN ('qualified','meeting_scheduled','converted'))::int AS wins,
              COUNT(DISTINCT a.lead_id)::int AS unique_leads,
              COUNT(DISTINCT a.at::date)::int AS active_days,
              MAX(a.at) AS last_attempt_at
       FROM users u
       LEFT JOIN call_attempts a ON a.user_id = u.id AND a.at > NOW() - (? || ' days')::interval
       WHERE u.is_active_caller = TRUE
       GROUP BY u.id, u.name
       ORDER BY attempts_total DESC`,
      String(days),
    );
    res.json({ managers: rows, period_days: days });
  }),
);

// ============ АКТИВНЫЕ ОБЗВОНЩИКИ (для распределения) ============

router.get(
  '/active-managers',
  asyncHandler(async (req, res) => {
    requireCampaignAdmin(req);
    const rows = await db.all(
      `SELECT id, name, email, role, calling_capacity, calling_ready
       FROM users WHERE is_active_caller = TRUE AND active = TRUE
       ORDER BY name`,
    );
    res.json({ managers: rows });
  }),
);

export default router;
