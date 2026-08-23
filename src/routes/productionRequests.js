// Модуль «Просчёты производства».
//
// Флоу: менеджер создаёт заявку (клиент обязательный + текст + файлы) →
// отправляет на просчёт → производство (director_prod/foreman) заполняет
// cost_price / client_price / вознаграждение → менеджер видит финальную
// цену и своё вознаграждение (но НЕ cost_price) → согласование с клиентом
// (одобрить / вернуть с торгом / отменить) → выполнение → выплата.
//
// Права:
//   - manager/sales: свои заявки, видят client_price + reward_computed, НЕ видят cost_price.
//   - director_prod/foreman: все заявки, видят всё (включая cost), заполняют просчёт.
//   - admin/rop: всё + переход в 'paid'.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { notify } from '../services/notifications.js';

const router = Router();
router.use(authenticate);

const STATUSES = ['draft', 'awaiting_cost', 'priced', 'negotiating', 'approved', 'awaiting_payment', 'in_progress', 'fulfilled', 'paid', 'cancelled', 'rejected'];
const PROD_ROLES = ['director_prod', 'foreman'];
const MANAGER_ROLES = ['manager', 'sales', 'rop'];

function isProd(u) { return PROD_ROLES.includes(u.role); }
function isAdmin(u) { return u.role === 'admin' || u.role === 'rop'; }
function isFullAccess(u) { return u.role === 'admin' || u.role === 'rop' || isProd(u); }
// Вознаграждение менеджера видят и назначают: только директор производства + admin/rop.
// Foreman (начальник цеха) НЕ видит — иначе может сравнить с зарплатой и т.д.
function canSeeReward(u) { return u.role === 'admin' || u.role === 'rop' || u.role === 'director_prod'; }

// Основной сериализатор:
//   - менеджеру скрываем cost_price (себестоимость производства);
//   - foreman скрываем reward_* (вознаграждение менеджера) — «мотивация» его не касается.
function sanitizeRequest(row, user) {
  if (!row) return row;
  const canSeeCost = isFullAccess(user);
  const out = { ...row };
  if (!canSeeCost) delete out.cost_price;
  if (!canSeeReward(user)) {
    delete out.reward_type;
    delete out.reward_value;
    delete out.reward_computed;
  }
  return out;
}

function computeReward(client_price, reward_type, reward_value) {
  if (reward_value == null) return null;
  const price = Number(client_price || 0);
  const val = Number(reward_value);
  if (reward_type === 'percent') return +(price * val / 100).toFixed(2);
  if (reward_type === 'fixed') return +val.toFixed(2);
  return null;
}

// ============ LIST ============

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const u = req.user;
    const where = [];
    const params = [];
    if (!isFullAccess(u)) {
      // менеджер — только свои
      where.push('r.manager_id = ?'); params.push(u.id);
    }
    if (req.query.status) {
      where.push('r.status = ?'); params.push(String(req.query.status));
    }
    if (req.query.manager_id) {
      where.push('r.manager_id = ?'); params.push(Number(req.query.manager_id));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT r.id, r.title, r.status, r.manager_id, r.contact_id, r.company_id,
              r.client_price, r.cost_price, r.reward_type, r.reward_value, r.reward_computed,
              r.deadline, r.production_deadline, r.created_at, r.updated_at,
              m.name AS manager_name,
              c.first_name AS contact_first, c.last_name AS contact_last,
              co.name AS company_name,
              (SELECT COUNT(*)::int FROM production_request_files f WHERE f.request_id = r.id) AS files_count,
              (SELECT COUNT(*)::int FROM production_request_messages msg WHERE msg.request_id = r.id) AS messages_count
       FROM production_requests r
       LEFT JOIN users m ON m.id = r.manager_id
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN companies co ON co.id = r.company_id
       ${whereSql}
       ORDER BY r.updated_at DESC
       LIMIT 100`,
      ...params,
    );
    res.json({ requests: rows.map((r) => sanitizeRequest(r, u)) });
  }),
);

// ============ GET ONE ============

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const u = req.user;
    const row = await db.get(
      `SELECT r.*, m.name AS manager_name, p.name AS priced_by_name,
              c.first_name AS contact_first, c.last_name AS contact_last, c.phone AS contact_phone,
              co.name AS company_name
       FROM production_requests r
       LEFT JOIN users m ON m.id = r.manager_id
       LEFT JOIN users p ON p.id = r.priced_by
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN companies co ON co.id = r.company_id
       WHERE r.id = ?`,
      id,
    );
    if (!row) throw NotFound('Заявка не найдена');
    if (!isFullAccess(u) && row.manager_id !== u.id) {
      throw Forbidden('Заявка не ваша');
    }
    // Файлы: менеджер не видит production_only. Файлы чата (chat_message_id
    // IS NOT NULL) исключаем из общего списка — они показываются внутри чата.
    const canSeeAllFiles = isFullAccess(u);
    const files = await db.all(
      `SELECT id, filename, mime, size_bytes, uploaded_at, visibility, uploaded_by
       FROM production_request_files
       WHERE request_id = ? AND chat_message_id IS NULL${canSeeAllFiles ? '' : " AND visibility = 'all'"}
       ORDER BY id`,
      id,
    );
    const history = await db.all(
      `SELECT h.*, u.name AS actor_name
       FROM production_request_price_history h LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.request_id = ? ORDER BY h.at DESC`,
      id,
    );
    // История цен: менеджер не видит cost_price там тоже.
    const canSeeCost = isFullAccess(u);
    const cleanHistory = canSeeCost ? history : history.map((h) => { const c = { ...h }; delete c.cost_price; return c; });
    res.json({ request: sanitizeRequest(row, u), files, history: cleanHistory });
  }),
);

// ============ CREATE ============

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  contact_id: z.number().int().positive().optional().nullable(),
  company_id: z.number().int().positive().optional().nullable(),
  estimated_work_days: z.number().int().min(1).max(365).optional().nullable(),
  files: z.array(z.object({
    filename: z.string().max(300),
    mime: z.string().max(100).optional().nullable(),
    data_base64: z.string(), // может быть с data:...;base64, префиксом
  })).max(20).optional().default([]),
});

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function stripDataUri(b64) {
  // Отрезаем data:image/png;base64, если пришло с префиксом.
  const m = String(b64).match(/^data:[^;]+;base64,(.+)$/);
  return m ? m[1] : b64;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const u = req.user;
    // Создавать заявку могут: менеджеры продаж (manager/sales/rop), admin,
    // а также сотрудники производства (director_prod, foreman) — им бывает
    // нужно оформить внутреннюю заявку самим себе (например, изготовить
    // прототип, инструмент, восполнить брак).
    const ALLOWED_CREATE_ROLES = ['manager', 'sales', 'rop', 'admin', 'director_prod', 'foreman'];
    if (!ALLOWED_CREATE_ROLES.includes(u.role)) {
      throw Forbidden('У вашей роли нет права создавать заявки на просчёт');
    }
    const data = createSchema.parse(req.body || {});
    if (!data.contact_id && !data.company_id) throw BadRequest('Обязательно укажите клиента (контакт или организацию)');

    const request = await db.withTransaction(async (tx) => {
      const r = await tx.get(
        `INSERT INTO production_requests
          (title, description, deadline, manager_id, contact_id, company_id, estimated_work_days, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
         RETURNING *`,
        data.title, data.description || null, data.deadline || null,
        u.id, data.contact_id || null, data.company_id || null,
        data.estimated_work_days || null,
      );
      // Файлы.
      for (const f of data.files) {
        const raw = stripDataUri(f.data_base64);
        // Размер: base64 raises size on ~1.37x. Оценим оригинал.
        const sizeBytes = Math.floor(raw.length * 0.75);
        if (sizeBytes > MAX_FILE_BYTES) {
          throw BadRequest(`Файл ${f.filename} больше 10 МБ (${(sizeBytes / 1024 / 1024).toFixed(1)} МБ). Уменьшите.`);
        }
        await tx.run(
          `INSERT INTO production_request_files (request_id, filename, mime, size_bytes, data_base64, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          r.id, f.filename, f.mime || null, sizeBytes, raw, u.id,
        );
      }
      return r;
    });
    await logAction(req, {
      action: 'production_request.created',
      entity_type: 'production_request', entity_id: request.id,
      details: { title: request.title, files_count: data.files.length },
    });
    res.status(201).json(sanitizeRequest(request, u));
  }),
);

// ============ UPDATE (draft only, для менеджера) ============

// PATCH /:id — обновление заявки.
// Права:
//   - Менеджер-владелец: только draft, только описание/клиент/дедлайн/estimated.
//   - Директор производства / admin / rop: ЛЮБОЙ статус (кроме терминальных
//     paid/cancelled/rejected), любые поля включая финансы (cost/price/reward)
//     и производственные сроки (work_start/end/production_deadline).
// Каждое изменение логируется в price_history + системное сообщение в чат
// с diff-описанием (кто что поменял).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const managerPatchFields = ['title', 'description', 'deadline', 'contact_id', 'company_id', 'estimated_work_days'];
const directorPatchFields = [
  ...managerPatchFields,
  'cost_price', 'client_price', 'reward_type', 'reward_value',
  'production_deadline', 'work_start_date', 'work_end_date',
];

const managerPatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  contact_id: z.number().int().positive().optional().nullable(),
  company_id: z.number().int().positive().optional().nullable(),
  estimated_work_days: z.number().int().min(1).max(365).optional().nullable(),
});
const directorPatchSchema = managerPatchSchema.extend({
  cost_price: z.number().nonnegative().optional().nullable(),
  client_price: z.number().nonnegative().optional().nullable(),
  reward_type: z.enum(['percent', 'fixed']).optional().nullable(),
  reward_value: z.number().nonnegative().optional().nullable(),
  production_deadline: z.string().regex(DATE_RE, 'YYYY-MM-DD').optional().nullable(),
  work_start_date: z.string().regex(DATE_RE, 'YYYY-MM-DD').optional().nullable(),
  work_end_date: z.string().regex(DATE_RE, 'YYYY-MM-DD').optional().nullable(),
  edit_note: z.string().max(500).optional().nullable(),
});

// Форматтер значения для человекочитаемого лога.
function fmtVal(k, v) {
  if (v == null || v === '') return '—';
  if (['cost_price', 'client_price', 'reward_value'].includes(k)) return `${Number(v).toLocaleString('ru-RU')} ₽`;
  if (['production_deadline', 'work_start_date', 'work_end_date'].includes(k)) return String(v).slice(0, 10);
  if (['deadline'].includes(k)) return String(v).slice(0, 10);
  if (k === 'reward_type') return v === 'percent' ? '% от цены' : 'фикс ₽';
  if (k === 'estimated_work_days') return `${v} дн.`;
  return String(v).slice(0, 60);
}
const fieldLabels = {
  title: 'Название', description: 'Описание', deadline: 'Срок клиента (заявки)',
  contact_id: 'Контакт', company_id: 'Компания',
  estimated_work_days: 'Оценка работы',
  cost_price: 'Себестоимость', client_price: 'Цена клиенту',
  reward_type: 'Тип вознаграждения', reward_value: 'Значение вознаграждения',
  production_deadline: 'Сдача клиенту', work_start_date: 'Начало работ', work_end_date: 'Конец работ',
};

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const u = req.user;
    const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
    if (!row) throw NotFound('Заявка не найдена');
    if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');

    const isDirector = u.role === 'admin' || u.role === 'rop' || u.role === 'director_prod';
    // Ограничение статусов.
    if (!isDirector) {
      if (row.status !== 'draft') throw BadRequest('Править можно только в статусе «Черновик»');
    } else {
      if (['paid', 'cancelled', 'rejected'].includes(row.status)) {
        throw BadRequest('Заявка в терминальном статусе — редактирование недоступно');
      }
    }

    const schema = isDirector ? directorPatchSchema : managerPatchSchema;
    const data = schema.parse(req.body || {});
    // Foreman не должен править вознаграждение (уже отфильтровано ролью выше).
    if (!canSeeReward(u)) { delete data.reward_type; delete data.reward_value; }

    // Валидация сроков (если директор их меняет).
    const finalDeadline = data.production_deadline ?? (row.production_deadline ? String(row.production_deadline).slice(0, 10) : null);
    const finalStart = data.work_start_date ?? (row.work_start_date ? String(row.work_start_date).slice(0, 10) : null);
    const finalEnd = data.work_end_date ?? (row.work_end_date ? String(row.work_end_date).slice(0, 10) : null);
    if (finalStart && finalEnd && finalStart > finalEnd) throw BadRequest('Начало работ позже окончания');
    if (finalEnd && finalDeadline && finalEnd > finalDeadline) throw BadRequest('Окончание работ позже срока сдачи клиенту');

    // Собираем diff — что реально поменялось, для лога и чата.
    const changed = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'edit_note') continue;
      const oldRaw = row[k];
      // Нормализуем для сравнения (dates → YYYY-MM-DD).
      let oldNorm = oldRaw;
      if (['production_deadline', 'work_start_date', 'work_end_date'].includes(k) && oldRaw) oldNorm = String(oldRaw).slice(0, 10);
      if (String(oldNorm ?? '') !== String(v ?? '')) changed.push({ field: k, from: oldNorm, to: v });
    }

    // Готовим SET.
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'edit_note') continue;
      // Даты — приводим типа DATE.
      if (['production_deadline', 'work_start_date', 'work_end_date'].includes(k) && v) {
        sets.push(`${k} = ?::date`); params.push(v);
      } else {
        sets.push(`${k} = ?`); params.push(v);
      }
    }
    // Пересчёт вознаграждения если менялся client_price или reward_*.
    const finalClientPrice = data.client_price ?? row.client_price;
    const finalRewardType = 'reward_type' in data ? data.reward_type : row.reward_type;
    const finalRewardValue = 'reward_value' in data ? data.reward_value : row.reward_value;
    if (finalClientPrice != null && finalRewardType && finalRewardValue != null) {
      const rc = computeReward(finalClientPrice, finalRewardType, finalRewardValue);
      sets.push('reward_computed = ?'); params.push(rc);
    } else if ('reward_type' in data || 'reward_value' in data) {
      // Обнуляем reward_computed если тип или значение стали null.
      if (data.reward_type === null || data.reward_value === null) { sets.push('reward_computed = NULL'); }
    }

    if (!sets.length) return res.json(sanitizeRequest(row, u));
    sets.push('updated_at = NOW()');
    params.push(id);
    const upd = await db.withTransaction(async (tx) => {
      const r = await tx.get(`UPDATE production_requests SET ${sets.join(', ')} WHERE id = ? RETURNING *`, ...params);
      if (changed.length) {
        // Запись в price_history — вcё вместе как production_reprice.
        const diffText = changed
          .map((c) => `${fieldLabels[c.field] || c.field}: ${fmtVal(c.field, c.from)} → ${fmtVal(c.field, c.to)}`)
          .join('; ');
        await tx.run(
          `INSERT INTO production_request_price_history
            (request_id, event, cost_price, client_price, reward_type, reward_value, reward_computed, note, actor_id)
           VALUES (?, 'production_reprice', ?, ?, ?, ?, ?, ?, ?)`,
          id,
          r.cost_price, r.client_price, r.reward_type, r.reward_value, r.reward_computed,
          `Правка ${u.name || u.email}: ${diffText}${data.edit_note ? '. ' + data.edit_note : ''}`,
          u.id,
        );
        // Системное сообщение в чат — все участники сразу видят кто что изменил.
        await tx.run(
          `INSERT INTO production_request_messages (request_id, user_id, kind, text)
           VALUES (?, ?, 'system', ?)`,
          id, u.id,
          `✏️ ${u.name || u.email} изменил${data.edit_note ? ' (' + data.edit_note + ')' : ''}: ${diffText}`,
        );
      }
      return r;
    });

    await logAction(req, {
      action: 'production_request.updated',
      entity_type: 'production_request', entity_id: id,
      details: { changed: changed.map((c) => c.field), by_director: isDirector },
    });
    // Менеджер получает уведомление если менял не он сам и есть финансовые/срочные изменения.
    const importantChanged = changed.some((c) => ['client_price', 'reward_value', 'reward_type', 'production_deadline', 'work_start_date', 'work_end_date'].includes(c.field));
    if (importantChanged && upd.manager_id !== u.id) {
      await notifyManagerOfRequest(id, upd, `Внесены изменения: ${changed.length} поле${changed.length === 1 ? '' : 'й'}`, u).catch(() => {});
    }
    res.json(sanitizeRequest(upd, u));
  }),
);

// ============ ACTIONS (переходы статусов) ============

// Менеджер: draft → awaiting_cost
router.post('/:id/submit', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  if (row.status !== 'draft') throw BadRequest('Отправить можно только из «Черновик»');
  const upd = await db.get(
    `UPDATE production_requests SET status='awaiting_cost', updated_at=NOW() WHERE id=? RETURNING *`,
    id,
  );
  await logAction(req, { action: 'production_request.submit', entity_type: 'production_request', entity_id: id });
  await notifyProduction(id, upd, 'submit', u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Производство: awaiting_cost → priced (или negotiating → priced при повторном просчёте).
// reward_type/reward_value ОПЦИОНАЛЬНЫ:
//   - foreman НЕ передаёт их (в UI поля скрыты) → в БД будут NULL пока директор не установит;
//   - director_prod/admin/rop могут задать сразу — цена + вознаграждение единым действием.
// Если reward не задан — заявка становится priced, но пока reward=null менеджер увидит
// «вознаграждение уточняется» (finish в UI). Директор потом использует /:id/set-reward.
const priceSchema = z.object({
  cost_price: z.number().nonnegative(),
  client_price: z.number().nonnegative(),
  reward_type: z.enum(['percent', 'fixed']).optional().nullable(),
  reward_value: z.number().nonnegative().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
router.post('/:id/price', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden('Просчитывать могут director_prod, foreman и админ');
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'awaiting_cost' && row.status !== 'negotiating') {
    throw BadRequest('Просчитывать можно только в статусе «На просчёте» или «Торг»');
  }
  const data = priceSchema.parse(req.body || {});
  // foreman не может задавать вознаграждение — молча игнорируем, даже если передал.
  const canReward = canSeeReward(u);
  const rt = canReward ? (data.reward_type || null) : null;
  const rv = canReward ? (data.reward_value != null ? data.reward_value : null) : null;
  const rewardComputed = (rt && rv != null) ? computeReward(data.client_price, rt, rv) : null;
  const event = row.status === 'awaiting_cost' ? 'initial_price' : 'production_reprice';

  const upd = await db.withTransaction(async (tx) => {
    // Сохраняем существующее вознаграждение если foreman не заполнил (не обнуляем).
    const finalRt = canReward ? rt : row.reward_type;
    const finalRv = canReward ? rv : row.reward_value;
    const finalRc = canReward ? rewardComputed : (finalRt && finalRv != null ? computeReward(data.client_price, finalRt, finalRv) : row.reward_computed);
    const r = await tx.get(
      `UPDATE production_requests SET
         cost_price = ?, client_price = ?, reward_type = ?, reward_value = ?, reward_computed = ?,
         priced_by = ?, priced_at = NOW(), status = 'priced', updated_at = NOW()
       WHERE id = ? RETURNING *`,
      data.cost_price, data.client_price, finalRt, finalRv, finalRc,
      u.id, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history
        (request_id, event, cost_price, client_price, reward_type, reward_value, reward_computed, note, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, event, data.cost_price, data.client_price, finalRt, finalRv, finalRc,
      data.note || null, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.priced', entity_type: 'production_request', entity_id: id, details: { event, has_reward: !!upd.reward_computed } });
  if (upd.reward_computed != null) {
    await notifyManagerOfRequest(id, upd, `Просчёт готов. Цена: ${data.client_price} ₽, ваше вознаграждение: ${upd.reward_computed} ₽`, u).catch(() => {});
  } else {
    await notifyManagerOfRequest(id, upd, `Просчёт готов. Цена: ${data.client_price} ₽. Вознаграждение уточняет директор.`, u).catch(() => {});
  }
  res.json(sanitizeRequest(upd, u));
}));

// Отдельный endpoint: только для director_prod/admin/rop — задать/изменить вознаграждение
// менеджера. Работает в любом статусе кроме терминальных (cancelled/rejected/paid).
router.post('/:id/set-reward', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!canSeeReward(u)) throw Forbidden('Вознаграждение задаёт директор производства или админ');
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (['cancelled', 'rejected', 'paid'].includes(row.status)) throw BadRequest('Заявка завершена');
  const data = z.object({
    reward_type: z.enum(['percent', 'fixed']),
    reward_value: z.number().nonnegative(),
    note: z.string().max(500).optional().nullable(),
  }).parse(req.body || {});
  const computed = computeReward(row.client_price, data.reward_type, data.reward_value);
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET
         reward_type = ?, reward_value = ?, reward_computed = ?, updated_at = NOW()
       WHERE id = ? RETURNING *`,
      data.reward_type, data.reward_value, computed, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, client_price, reward_type, reward_value, reward_computed, note, actor_id)
       VALUES (?, 'production_reprice', ?, ?, ?, ?, ?, ?)`,
      id, row.client_price, data.reward_type, data.reward_value, computed,
      `Установлено вознаграждение: ${computed} ₽${data.note ? '. ' + data.note : ''}`, u.id,
    );
    return r;
  });
  await notifyManagerOfRequest(id, upd, `Ваше вознаграждение по заявке установлено: ${computed} ₽`, u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Производство: awaiting_cost или negotiating → rejected.
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden('Отклонять могут производство и админ');
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'awaiting_cost' && row.status !== 'negotiating') throw BadRequest('Не тот статус');
  const note = String(req.body?.note || '').slice(0, 2000);
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET status='rejected', cancel_reason=?, updated_at=NOW() WHERE id=? RETURNING *`,
      note || null, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, note, actor_id) VALUES (?, 'rejected', ?, ?)`,
      id, note || null, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.rejected', entity_type: 'production_request', entity_id: id });
  res.json(sanitizeRequest(upd, u));
}));

// Менеджер: priced → approved.
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  if (row.status !== 'priced') throw BadRequest('Одобрить можно только просчитанную заявку');
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET status='approved', approved_at=NOW(), updated_at=NOW() WHERE id=? RETURNING *`,
      id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, client_price, reward_computed, actor_id) VALUES (?, 'approved', ?, ?, ?)`,
      id, r.client_price, r.reward_computed, u.id,
    );
    await tx.run(
      `INSERT INTO production_request_messages (request_id, user_id, kind, text)
       VALUES (?, ?, 'system', ?)`,
      id, u.id, 'Клиент согласился. Заявка ждёт утверждения срока сдачи производством.',
    );
    return r;
  });
  await logAction(req, { action: 'production_request.approved', entity_type: 'production_request', entity_id: id });
  await notifyProduction(id, upd, 'approved', u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Производство: approved → awaiting_payment. Утверждается 3 даты:
//   production_deadline — когда сдаём клиенту.
//   work_start_date / work_end_date — плановый период РАБОТ (для календаря).
// Даты приходят как YYYY-MM-DD (DATE), храним в БД как DATE (без времени).
// Валидация: work_start ≤ work_end ≤ production_deadline (все три обязательны).
router.post('/:id/set-deadline', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden('Срок утверждает производство или админ');
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'approved' && row.status !== 'awaiting_payment' && row.status !== 'in_progress') {
    throw BadRequest('Срок утверждается/меняется из статусов Согласовано / Ждёт оплаты / В работе');
  }
  // YYYY-MM-DD валидация.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const data = z.object({
    production_deadline: z.string().regex(dateRe, 'YYYY-MM-DD'),
    work_start_date: z.string().regex(dateRe, 'YYYY-MM-DD'),
    work_end_date: z.string().regex(dateRe, 'YYYY-MM-DD'),
    note: z.string().max(500).optional().nullable(),
  }).parse(req.body || {});
  if (data.work_start_date > data.work_end_date) throw BadRequest('Начало работ позже окончания.');
  if (data.work_end_date > data.production_deadline) throw BadRequest('Окончание работ позже срока сдачи клиенту.');

  // Если уже в awaiting_payment/in_progress — просто обновляем даты, статус не меняем.
  const nextStatus = row.status === 'approved' ? 'awaiting_payment' : row.status;

  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET
         production_deadline = ?::date,
         work_start_date = ?::date,
         work_end_date = ?::date,
         deadline_set_by = ?, deadline_set_at = NOW(),
         status = ?, updated_at = NOW()
       WHERE id = ? RETURNING *`,
      data.production_deadline, data.work_start_date, data.work_end_date,
      u.id, nextStatus, id,
    );
    const noteText = `Сдача клиенту: ${data.production_deadline} · работа ${data.work_start_date} — ${data.work_end_date}${data.note ? '. ' + data.note : ''}`;
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, note, actor_id)
       VALUES (?, 'deadline_set', ?, ?)`,
      id, noteText, u.id,
    );
    await tx.run(
      `INSERT INTO production_request_messages (request_id, user_id, kind, text)
       VALUES (?, ?, 'system', ?)`,
      id, u.id, `📅 Сроки обновлены. Сдача клиенту: ${data.production_deadline}. Работа: ${data.work_start_date} — ${data.work_end_date}.`,
    );
    return r;
  });
  await logAction(req, {
    action: 'production_request.deadline_set',
    entity_type: 'production_request', entity_id: id,
    details: { deadline: data.production_deadline, work_start: data.work_start_date, work_end: data.work_end_date },
  });
  await notifyManagerOfRequest(id, upd, `Срок сдачи ${data.production_deadline}. Работа ${data.work_start_date}–${data.work_end_date}.`, u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Производство/админ: awaiting_payment → in_progress (оплата пришла).
router.post('/:id/mark-paid', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden();
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'awaiting_payment') throw BadRequest('Оплату отмечаем в статусе «Ждёт оплаты»');
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET
         payment_received_at=NOW(), payment_marked_by=?, status='in_progress', updated_at=NOW()
       WHERE id=? RETURNING *`,
      u.id, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, actor_id) VALUES (?, 'payment_received', ?)`,
      id, u.id,
    );
    await tx.run(
      `INSERT INTO production_request_messages (request_id, user_id, kind, text)
       VALUES (?, ?, 'system', ?)`,
      id, u.id, 'Оплата получена. Заявка взята в работу.',
    );
    return r;
  });
  await logAction(req, { action: 'production_request.payment_received', entity_type: 'production_request', entity_id: id });
  await notifyManagerOfRequest(id, upd, 'Оплата получена, заявка в работе', u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Менеджер: priced → negotiating (клиент просит другую цену).
router.post('/:id/counter', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  if (row.status !== 'priced') throw BadRequest('Торг доступен из «Просчитано»');
  const data = z.object({
    requested_price: z.number().nonnegative(),
    note: z.string().max(2000).min(1),
  }).parse(req.body || {});
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET status='negotiating', updated_at=NOW() WHERE id=? RETURNING *`,
      id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, client_price, note, actor_id)
       VALUES (?, 'manager_counter', ?, ?, ?)`,
      id, data.requested_price, data.note, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.counter', entity_type: 'production_request', entity_id: id });
  await notifyProduction(id, upd, 'counter', u).catch(() => {});
  res.json(sanitizeRequest(upd, u));
}));

// Менеджер: любой статус (кроме терминальных) → cancelled.
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  if (['paid', 'cancelled', 'rejected'].includes(row.status)) throw BadRequest('Уже завершена');
  const note = String(req.body?.note || '').slice(0, 2000);
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET status='cancelled', cancel_reason=?, updated_at=NOW() WHERE id=? RETURNING *`,
      note || null, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, note, actor_id) VALUES (?, 'cancelled', ?, ?)`,
      id, note || null, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.cancelled', entity_type: 'production_request', entity_id: id });
  res.json(sanitizeRequest(upd, u));
}));

// Производство: approved → in_progress.
router.post('/:id/start', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden();
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'approved') throw BadRequest('Только из «Одобрено»');
  const upd = await db.get(`UPDATE production_requests SET status='in_progress', updated_at=NOW() WHERE id=? RETURNING *`, id);
  await logAction(req, { action: 'production_request.start', entity_type: 'production_request', entity_id: id });
  res.json(sanitizeRequest(upd, u));
}));

// Производство: in_progress → fulfilled.
router.post('/:id/fulfill', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isProd(u) && !isAdmin(u)) throw Forbidden();
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'in_progress') throw BadRequest('Только из «В работе»');
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(`UPDATE production_requests SET status='fulfilled', fulfilled_at=NOW(), updated_at=NOW() WHERE id=? RETURNING *`, id);
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, actor_id) VALUES (?, 'fulfilled', ?)`,
      id, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.fulfill', entity_type: 'production_request', entity_id: id });
  res.json(sanitizeRequest(upd, u));
}));

// Админ: fulfilled → paid (менеджеру выплатили вознаграждение).
router.post('/:id/pay', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isAdmin(u)) throw Forbidden('Отмечать выплату может только admin/rop');
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (row.status !== 'fulfilled') throw BadRequest('Оплатить можно только выполненную');
  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(`UPDATE production_requests SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=? RETURNING *`, id);
    await tx.run(
      `INSERT INTO production_request_price_history (request_id, event, reward_computed, actor_id) VALUES (?, 'paid', ?, ?)`,
      id, r.reward_computed, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.pay', entity_type: 'production_request', entity_id: id, details: { reward: row.reward_computed } });
  res.json(sanitizeRequest(upd, u));
}));

// DELETE /:id — навсегда снести заявку (только admin/rop). Используется для
// тестовых записей и мусора. Каскадно удалит файлы, сообщения, историю цен.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  if (!isAdmin(u)) throw Forbidden('Удалять заявки может только admin/rop');
  const row = await db.get(`SELECT id, title FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  await db.run(`DELETE FROM production_requests WHERE id = ?`, id);
  await logAction(req, {
    action: 'production_request.deleted',
    entity_type: 'production_request', entity_id: id,
    details: { title: row.title },
  });
  res.status(204).end();
}));

// ============ FILES ============

// Скачать файл. Возвращаем как binary (декодируем base64).
router.get('/files/:fileId', asyncHandler(async (req, res) => {
  const fid = Number(req.params.fileId);
  const u = req.user;
  const f = await db.get(
    `SELECT f.*, r.manager_id, r.status FROM production_request_files f
     JOIN production_requests r ON r.id = f.request_id
     WHERE f.id = ?`,
    fid,
  );
  if (!f) throw NotFound('Файл не найден');
  // Менеджер: только СВОЯ заявка + не 'production_only'.
  if (!isFullAccess(u)) {
    if (f.manager_id !== u.id) throw Forbidden('Не ваш файл');
    if (f.visibility === 'production_only') throw Forbidden('Файл доступен только производству');
  }
  const buf = Buffer.from(f.data_base64, 'base64');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`);
  res.send(buf);
}));

// Загрузить файл к существующей заявке.
// visibility='all' (по умолчанию) — менеджер-владелец в draft или admin.
// visibility='production_only' — производство/admin в любом статусе (файл калькуляции).
router.post('/:id/files', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  const data = z.object({
    filename: z.string().max(300),
    mime: z.string().max(100).optional().nullable(),
    data_base64: z.string(),
    visibility: z.enum(['all', 'production_only']).default('all'),
  }).parse(req.body || {});

  if (data.visibility === 'production_only') {
    if (!isProd(u) && !isAdmin(u)) throw Forbidden('Файлы калькуляции загружает только производство или админ');
  } else {
    if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
    if (row.status !== 'draft' && !isAdmin(u)) throw BadRequest('Файлы к заявке добавляют только в черновике');
  }
  const raw = stripDataUri(data.data_base64);
  const size = Math.floor(raw.length * 0.75);
  if (size > MAX_FILE_BYTES) throw BadRequest('Файл больше 10 МБ');
  const f = await db.get(
    `INSERT INTO production_request_files (request_id, filename, mime, size_bytes, data_base64, uploaded_by, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, filename, mime, size_bytes, uploaded_at, visibility`,
    id, data.filename, data.mime || null, size, raw, u.id, data.visibility,
  );
  res.status(201).json(f);
}));

// Удалить файл (владелец в draft или админ).
router.delete('/files/:fileId', asyncHandler(async (req, res) => {
  const fid = Number(req.params.fileId);
  const u = req.user;
  const f = await db.get(
    `SELECT f.*, r.manager_id, r.status FROM production_request_files f
     JOIN production_requests r ON r.id = f.request_id
     WHERE f.id = ?`,
    fid,
  );
  if (!f) throw NotFound();
  if (!isAdmin(u)) {
    if (f.manager_id !== u.id) throw Forbidden();
    if (f.status !== 'draft') throw BadRequest('Удалять файлы можно только в черновике');
  }
  await db.run(`DELETE FROM production_request_files WHERE id = ?`, fid);
  res.status(204).end();
}));

// ============ ЧАТ В ЗАЯВКЕ ============

// GET /:id/messages — весь тред. Возвращает вложение файла (если было).
router.get('/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT manager_id FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  const msgs = await db.all(
    `SELECT m.id, m.request_id, m.user_id, m.text, m.kind, m.created_at,
            u.name AS user_name, u.role AS user_role,
            f.id AS attachment_id, f.filename AS attachment_filename,
            f.mime AS attachment_mime, f.size_bytes AS attachment_size
     FROM production_request_messages m
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN production_request_files f ON f.chat_message_id = m.id
     WHERE m.request_id = ? ORDER BY m.created_at ASC`,
    id,
  );
  res.json({ messages: msgs });
}));

// POST /:id/messages — написать сообщение. Опционально с вложением.
// Тело: { text: string, attachment?: { filename, mime, data_base64 } }.
// Хотя бы одно из text/attachment должно быть.
router.post('/:id/messages', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  const data = z.object({
    text: z.string().max(4000).optional().default(''),
    attachment: z.object({
      filename: z.string().max(300),
      mime: z.string().max(100).optional().nullable(),
      data_base64: z.string(),
    }).optional().nullable(),
  }).parse(req.body || {});
  const hasText = (data.text || '').trim().length > 0;
  const hasAttachment = !!data.attachment;
  if (!hasText && !hasAttachment) throw BadRequest('Введите текст или прикрепите файл');

  const result = await db.withTransaction(async (tx) => {
    // Сообщение (текст может быть пустым если только файл).
    const m = await tx.get(
      `INSERT INTO production_request_messages (request_id, user_id, text)
       VALUES (?, ?, ?) RETURNING *`,
      id, u.id, hasText ? data.text.trim() : (hasAttachment ? `📎 ${data.attachment.filename}` : ''),
    );
    let attachment = null;
    if (hasAttachment) {
      const raw = stripDataUri(data.attachment.data_base64);
      const size = Math.floor(raw.length * 0.75);
      if (size > MAX_FILE_BYTES) throw BadRequest('Файл больше 10 МБ');
      attachment = await tx.get(
        `INSERT INTO production_request_files
           (request_id, filename, mime, size_bytes, data_base64, uploaded_by, visibility, chat_message_id)
         VALUES (?, ?, ?, ?, ?, ?, 'all', ?)
         RETURNING id, filename, mime, size_bytes`,
        id, data.attachment.filename, data.attachment.mime || null, size, raw, u.id, m.id,
      );
    }
    return {
      ...m,
      attachment_id: attachment?.id || null,
      attachment_filename: attachment?.filename || null,
      attachment_mime: attachment?.mime || null,
      attachment_size: attachment?.size_bytes || null,
    };
  });

  const preview = hasText ? data.text.trim().slice(0, 200) : `📎 ${data.attachment.filename}`;
  await notifyChatParticipants(id, row, u, preview).catch(() => {});
  res.status(201).json(result);
}));

// ============ КАЛЕНДАРЬ ============

// GET /calendar?from=...&to=... — заявки, чей период [start, end] пересекается
// с [from, to]. Возвращаем достаточно полей, чтобы фронт мог сам вычислить
// начало и конец полосы:
//   start_date = COALESCE(payment_received_at, deadline_set_at, approved_at, created_at)
//   end_date   = COALESCE(fulfilled_at, production_deadline)
router.get('/calendar/entries', asyncHandler(async (req, res) => {
  const u = req.user;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  // Показываем всё активное + завершённое (без cancelled/rejected).
  // Требуем production_deadline (иначе полосу не нарисовать).
  const where = [
    `r.status NOT IN ('cancelled','rejected')`,
    'r.production_deadline IS NOT NULL',
  ];
  const params = [];
  if (!isFullAccess(u)) { where.push('r.manager_id = ?'); params.push(u.id); }
  if (from) {
    // Пересечение периодов: end >= from AND start <= to.
    where.push('COALESCE(r.fulfilled_at, r.production_deadline) >= ?');
    params.push(from);
  }
  if (to) {
    where.push('COALESCE(r.payment_received_at, r.deadline_set_at, r.approved_at, r.created_at) <= ?');
    params.push(to);
  }
  const rows = await db.all(
    `SELECT r.id, r.title, r.status, r.production_deadline, r.deadline_set_at,
            r.work_start_date, r.work_end_date, r.estimated_work_days,
            r.approved_at, r.payment_received_at, r.fulfilled_at, r.paid_at, r.created_at,
            r.client_price, r.reward_computed,
            m.name AS manager_name,
            c.first_name AS contact_first, c.last_name AS contact_last,
            co.name AS company_name
     FROM production_requests r
     LEFT JOIN users m ON m.id = r.manager_id
     LEFT JOIN contacts c ON c.id = r.contact_id
     LEFT JOIN companies co ON co.id = r.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.production_deadline ASC
     LIMIT 500`,
    ...params,
  );
  res.json({ entries: rows.map((r) => sanitizeRequest(r, u)) });
}));

// ============ ХЕЛПЕРЫ УВЕДОМЛЕНИЙ ============

async function notifyManagerOfRequest(requestId, request, text, actor) {
  if (!request.manager_id || request.manager_id === actor.id) return;
  await notify(
    request.manager_id,
    'production_request',
    `Заявка #${requestId}: ${request.title || ''}`,
    text,
    `#/production-requests?id=${requestId}`,
  );
}

async function notifyProduction(requestId, request, event, actor) {
  const prod = await db.all(
    `SELECT id FROM users WHERE role IN ('director_prod','foreman') AND active=TRUE AND id <> ?`,
    actor.id,
  );
  const titles = {
    approved: 'Клиент согласился — нужно утвердить срок',
    submit: 'Новая заявка на просчёт',
    counter: 'Менеджер вернул с торгом — пересчитать',
  };
  for (const p of prod) {
    await notify(
      p.id,
      'production_request',
      `Заявка #${requestId}: ${request.title || ''}`,
      titles[event] || `Событие: ${event}`,
      `#/production-requests?id=${requestId}`,
    );
  }
}

async function notifyChatParticipants(requestId, request, author, text) {
  const targets = new Set();
  if (request.manager_id && request.manager_id !== author.id) targets.add(request.manager_id);
  const others = await db.all(
    `SELECT id FROM users WHERE active=TRUE AND role IN ('director_prod','foreman','admin') AND id <> ?`,
    author.id,
  );
  for (const o of others) targets.add(o.id);
  for (const uid of targets) {
    await notify(
      uid,
      'production_request_chat',
      `💬 Заявка #${requestId}: ${author.name}`,
      text,
      `#/production-requests?id=${requestId}`,
    );
  }
}

export default router;
