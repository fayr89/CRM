// Vercel serverless entry: оборачивает Express-приложение в функцию.
// Все обращения к /api/* и /health пробрасываются сюда через vercel.json.
import { createApp } from '../src/app.js';
import { ensureInitialized } from '../src/db.js';

let initPromise = null;
const app = createApp({ serveStatic: false });

// Извлекаем хост из DATABASE_URL без пароля для диагностики
function dbHostInfo() {
  try {
    const url = process.env.DATABASE_URL || '';
    const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):[^@]+@([^:/]+):?(\d+)?\/(.+)$/);
    if (!m) return { error: 'DATABASE_URL не парсится или не задан', set: !!url, length: url.length };
    return {
      user: m[1],
      host: m[2],
      port: m[3] || '5432',
      database: m[4],
      url_length: url.length,
    };
  } catch (e) {
    return { error: 'parse failed: ' + e.message };
  }
}

// Транзиентная ошибка коннекта = БД скорее всего просыпается / временный сбой.
// Отдаём 503 + Retry-After, чтобы Vercel / клиент понял: не совсем «упали»,
// повторите через несколько секунд. Всё, что не транзиентно (auth, protocol) —
// остаётся 500, потому что само не проснётся.
function isTransientConnect(e) {
  const code = e?.code || '';
  const msg = String(e?.message || '').toLowerCase();
  return code === '08006' || code === '08001' || code === '08000'
    || code === '08003' || code === '08004'
    || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
    || code === 'ECONNRESET' || code === 'EAI_AGAIN'
    || msg.includes('timeout') || msg.includes('connection terminated')
    || msg.includes('failed to connect');
}

export default async function handler(req, res) {
  if (!initPromise) initPromise = ensureInitialized();
  try {
    await initPromise;
  } catch (e) {
    initPromise = null;
    // eslint-disable-next-line no-console
    console.error('[db-init] failed:', e?.code, e?.message);
    const transient = isTransientConnect(e);
    res.statusCode = transient ? 503 : 500;
    // charset=utf-8 обязательно: тело содержит русский текст, без явного
    // charset браузер декодирует как ISO-8859-1 → тарабарщина «Р‘Р°Р·Р°».
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (transient) res.setHeader('Retry-After', '15');
    res.end(JSON.stringify({
      error: transient
        ? 'База данных временно недоступна (возможно, просыпается). Попробуйте через 15 секунд.'
        : 'Database initialization failed',
      transient,
      detail: e.message,
      code: e.code,
      db_info: dbHostInfo(),
      node_version: process.version,
    }, null, 2));
    return;
  }
  return app(req, res);
}
