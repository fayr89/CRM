// Очередь МС-задач: enqueue, list, run, retry.
// Задача = { action, order_id, payload } — на каждое действие свой обработчик.
// Воркер: тихий, дёргается per-request middleware'ом (throttle).
import { db } from '../db.js';
import { decryptSecret } from './secrets.js';

// Маркеры лежат в app_settings: токен МС, кэш карт складов / контрагента / организации.
async function getSetting(key) {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = ?`, key).catch(() => null);
  return row?.value ?? null;
}

async function setSetting(key, value) {
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    key,
    JSON.stringify(value),
  );
}

// Возвращает дешифрованный токен МС или null, если не настроен.
export async function getMoyskladToken() {
  const raw = await getSetting('moysklad.token');
  if (!raw) return process.env.MOYSKLAD_TOKEN || null;
  try {
    return decryptSecret(raw);
  } catch {
    return null;
  }
}

// Состояние МС-конфига для отображения админу + проверки перед задачами.
export async function getMsConfig() {
  const [storeMap, counterpartyId, organizationId, initAt] = await Promise.all([
    getSetting('moysklad.store_map'),
    getSetting('moysklad.counterparty_id'),
    getSetting('moysklad.organization_id'),
    getSetting('moysklad.init_completed_at'),
  ]);
  return {
    store_map: storeMap || {},
    counterparty_id: counterpartyId || null,
    organization_id: organizationId || null,
    init_completed_at: initAt || null,
  };
}

export { setSetting as setMsSetting };

// Добавить задачу в очередь.
// Coalesce: если есть pending с тем же (order, action) — обновляем его payload
// (последнее намерение выигрывает: reserve → unreserve → reserve = финальный full).
// Если есть running — создаём новую pending, она выполнится после running.
// Сразу же AWAIT воркер: на Vercel-serverless фоновые setImmediate ненадёжны
// (лямбда может заморозиться после res.send), поэтому исполняем синхронно
// с таймаутом — если МС медленный, задача останется в pending для retry.
export async function enqueueMsJob(orderId, action, payload = {}) {
  const pending = await db.get(
    `SELECT id FROM ms_jobs WHERE order_id = ? AND action = ? AND status = 'pending' LIMIT 1`,
    orderId,
    action,
  );
  let result;
  if (pending) {
    await db.run(
      `UPDATE ms_jobs SET payload = ?::jsonb, attempts = 0, last_error = NULL,
       scheduled_at = NOW(), updated_at = NOW() WHERE id = ?`,
      JSON.stringify(payload),
      pending.id,
    );
    result = { coalesced: true, id: pending.id };
  } else {
    const r = await db.run(
      `INSERT INTO ms_jobs (order_id, action, payload) VALUES (?, ?, ?::jsonb) RETURNING id`,
      orderId,
      action,
      JSON.stringify(payload),
    );
    result = { skipped: false, id: r.lastInsertRowid };
  }
  // Жёсткий таймаут на синхронное исполнение, чтобы не задерживать ответ
  // пользователю — если МС не ответил за 12 сек, ответ уходит, задача остаётся
  // в очереди и подберётся следующим request'ом через middleware.
  try {
    await Promise.race([
      runPendingMsJobs(3),
      new Promise((resolve) => setTimeout(resolve, 12_000)),
    ]);
  } catch (e) {
    console.warn('[ms] inline run after enqueue:', e.message);
  }
  return result;
}

export async function listMsJobs({ status, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT j.*, o.reference_number AS order_reference
     FROM ms_jobs j LEFT JOIN orders o ON o.id = j.order_id
     ${whereSql} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const counts = await db.all(
    `SELECT status, COUNT(*)::int AS n FROM ms_jobs GROUP BY status`,
  );
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

// Сбросить failed обратно в pending.
export async function retryMsJob(id) {
  await db.run(
    `UPDATE ms_jobs SET status = 'pending', attempts = 0, last_error = NULL,
     scheduled_at = NOW(), updated_at = NOW() WHERE id = ?`,
    id,
  );
}

// Регистр обработчиков. Этап 1: только заглушки. Этапы 2–5 регистрируют реальные.
const HANDLERS = new Map();
export function registerMsHandler(action, fn) {
  HANDLERS.set(action, fn);
}

// Атомарно забрать одну pending-задачу (с FOR UPDATE SKIP LOCKED).
async function claimNextJob() {
  return await db.withTransaction(async (tx) => {
    const job = await tx.get(
      `SELECT * FROM ms_jobs WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!job) return null;
    await tx.run(
      `UPDATE ms_jobs SET status = 'running', attempts = attempts + 1, updated_at = NOW() WHERE id = ?`,
      job.id,
    );
    return job;
  });
}

// Запустить до N задач из очереди. Возвращает счётчик обработанных.
export async function runPendingMsJobs(limit = 5) {
  // Recovery: задачи, застрявшие в running >5 минут (лямбда упала / timeout),
  // возвращаем в pending для повторной попытки.
  try {
    await db.run(
      `UPDATE ms_jobs SET status = 'pending', last_error = 'recovered from stuck running',
       scheduled_at = NOW(), updated_at = NOW()
       WHERE status = 'running' AND updated_at < NOW() - INTERVAL '5 minutes'`,
    );
  } catch (e) {
    console.error('[ms] recovery sweep:', e.message);
  }
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob();
    if (!job) break;
    const handler = HANDLERS.get(job.action);
    try {
      if (!handler) throw new Error(`Нет обработчика для action='${job.action}'`);
      const result = await handler(job);
      await db.run(
        `UPDATE ms_jobs SET status = 'done', last_error = NULL,
         ms_document_id = COALESCE(?, ms_document_id), updated_at = NOW() WHERE id = ?`,
        result?.ms_document_id ?? null,
        job.id,
      );
    } catch (e) {
      const failed = job.attempts >= 5;
      // Экспоненциальный backoff: 30s, 2m, 8m, 30m, 2h.
      const delaySec = Math.min(2 * 60 * 60, 30 * 4 ** (job.attempts - 1));
      await db.run(
        `UPDATE ms_jobs SET status = ?, last_error = ?,
         scheduled_at = NOW() + (? || ' seconds')::interval, updated_at = NOW() WHERE id = ?`,
        failed ? 'failed' : 'pending',
        String(e.message || e).slice(0, 1000),
        delaySec,
        job.id,
      );
    }
    processed += 1;
  }
  return processed;
}

// Throttle: middleware вызывает воркер не чаще раз в 30 сек на инстанс лямбды.
let lastTickAt = 0;
export function tickMsQueue() {
  const now = Date.now();
  if (now - lastTickAt < 30_000) return;
  lastTickAt = now;
  // Fire-and-forget; ошибки логируем, не пробрасываем.
  runPendingMsJobs(5).catch((e) => console.error('[ms-queue] tick error:', e.message));
}
