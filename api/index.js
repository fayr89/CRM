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
    const m = url.match(/^postgres(?:ql)?\/\/([^:]+):[^@]+@([^:/]+):?(\d+)?\/(.+)$/);
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

export default async function handler(req, res) {
  if (!initPromise) initPromise = ensureInitialized();
  try {
    await initPromise;
  } catch (e) {
    initPromise = null;
    // eslint-disable-next-line no-console
    console.error('[db-init] failed:', e?.code, e?.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Database initialization failed',
      detail: e.message,
      code: e.code,
      db_info: dbHostInfo(),
      node_version: process.version,
    }, null, 2));
    return;
  }
  return app(req, res);
}
