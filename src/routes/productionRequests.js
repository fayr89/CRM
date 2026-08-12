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

const router = Router();
router.use(authenticate);

const STATUSES = ['draft', 'awaiting_cost', 'priced', 'negotiating', 'approved', 'in_progress', 'fulfilled', 'paid', 'cancelled', 'rejected'];
const PROD_ROLES = ['director_prod', 'foreman'];
const MANAGER_ROLES = ['manager', 'sales', 'rop'];

function isProd(u) { return PROD_ROLES.includes(u.role); }
function isAdmin(u) { return u.role === 'admin' || u.role === 'rop'; }
function isFullAccess(u) { return u.role === 'admin' || u.role === 'rop' || isProd(u); }

// Основной сериализатор: скрывает cost_price от менеджера.
function sanitizeRequest(row, user) {
  if (!row) return row;
  const canSeeCost = isFullAccess(user);
  const out = { ...row };
  if (!canSeeCost) delete out.cost_price;
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
      `SELECT r.*, m.name AS manager_name, c.first_name AS contact_first, c.last_name AS contact_last,
              co.name AS company_name,
              (SELECT COUNT(*)::int FROM production_request_files f WHERE f.request_id = r.id) AS files_count
       FROM production_requests r
       LEFT JOIN users m ON m.id = r.manager_id
       LEFT JOIN contacts c ON c.id = r.contact_id
       LEFT JOIN companies co ON co.id = r.company_id
       ${whereSql}
       ORDER BY r.updated_at DESC
       LIMIT 500`,
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
    const files = await db.all(
      `SELECT id, filename, mime, size_bytes, uploaded_at FROM production_request_files WHERE request_id = ? ORDER BY id`,
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
  files: z.array(z.object({
    filename: z.string().max(300),
    mime: z.string().max(100).optional().nullable(),
    data_base64: z.string(), // может быть с data:...;base64, префиксом
  })).max(10).optional().default([]),
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
    if (!MANAGER_ROLES.includes(u.role) && u.role !== 'admin') {
      throw Forbidden('Создавать заявки могут менеджеры и админ');
    }
    const data = createSchema.parse(req.body || {});
    if (!data.contact_id && !data.company_id) throw BadRequest('Обязательно укажите клиента (контакт или организацию)');

    const request = await db.withTransaction(async (tx) => {
      const r = await tx.get(
        `INSERT INTO production_requests
          (title, description, deadline, manager_id, contact_id, company_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')
         RETURNING *`,
        data.title, data.description || null, data.deadline || null,
        u.id, data.contact_id || null, data.company_id || null,
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

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const u = req.user;
    const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
    if (!row) throw NotFound('Заявка не найдена');
    if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
    if (row.status !== 'draft' && !isAdmin(u)) throw BadRequest('Править можно только в статусе «Черновик»');

    const data = z.object({
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(5000).optional().nullable(),
      deadline: z.string().datetime().optional().nullable(),
      contact_id: z.number().int().positive().optional().nullable(),
      company_id: z.number().int().positive().optional().nullable(),
    }).parse(req.body || {});
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(data)) { sets.push(`${k} = ?`); params.push(v); }
    if (!sets.length) return res.json(sanitizeRequest(row, u));
    sets.push('updated_at = NOW()');
    params.push(id);
    const upd = await db.get(`UPDATE production_requests SET ${sets.join(', ')} WHERE id = ? RETURNING *`, ...params);
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
  res.json(sanitizeRequest(upd, u));
}));

// Производство: awaiting_cost → priced (или negotiating → priced при повторном просчёте).
const priceSchema = z.object({
  cost_price: z.number().nonnegative(),
  client_price: z.number().nonnegative(),
  reward_type: z.enum(['percent', 'fixed']),
  reward_value: z.number().nonnegative(),
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
  const rewardComputed = computeReward(data.client_price, data.reward_type, data.reward_value);
  const event = row.status === 'awaiting_cost' ? 'initial_price' : 'production_reprice';

  const upd = await db.withTransaction(async (tx) => {
    const r = await tx.get(
      `UPDATE production_requests SET
         cost_price = ?, client_price = ?, reward_type = ?, reward_value = ?, reward_computed = ?,
         priced_by = ?, priced_at = NOW(), status = 'priced', updated_at = NOW()
       WHERE id = ? RETURNING *`,
      data.cost_price, data.client_price, data.reward_type, data.reward_value, rewardComputed,
      u.id, id,
    );
    await tx.run(
      `INSERT INTO production_request_price_history
        (request_id, event, cost_price, client_price, reward_type, reward_value, reward_computed, note, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, event, data.cost_price, data.client_price, data.reward_type, data.reward_value, rewardComputed,
      data.note || null, u.id,
    );
    return r;
  });
  await logAction(req, { action: 'production_request.priced', entity_type: 'production_request', entity_id: id, details: { event } });
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
    return r;
  });
  await logAction(req, { action: 'production_request.approved', entity_type: 'production_request', entity_id: id });
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
  if (!isFullAccess(u) && f.manager_id !== u.id) throw Forbidden('Не ваш файл');
  const buf = Buffer.from(f.data_base64, 'base64');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`);
  res.send(buf);
}));

// Загрузить файл к существующей заявке (только менеджер-владелец, только draft).
router.post('/:id/files', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const u = req.user;
  const row = await db.get(`SELECT * FROM production_requests WHERE id = ?`, id);
  if (!row) throw NotFound('Заявка не найдена');
  if (!isFullAccess(u) && row.manager_id !== u.id) throw Forbidden('Не ваша');
  if (row.status !== 'draft' && !isAdmin(u)) throw BadRequest('Добавлять файлы можно только в черновике');
  const data = z.object({
    filename: z.string().max(300),
    mime: z.string().max(100).optional().nullable(),
    data_base64: z.string(),
  }).parse(req.body || {});
  const raw = stripDataUri(data.data_base64);
  const size = Math.floor(raw.length * 0.75);
  if (size > MAX_FILE_BYTES) throw BadRequest('Файл больше 10 МБ');
  const f = await db.get(
    `INSERT INTO production_request_files (request_id, filename, mime, size_bytes, data_base64, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id, filename, mime, size_bytes, uploaded_at`,
    id, data.filename, data.mime || null, size, raw, u.id,
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

export default router;
