// Vercel serverless entry: оборачивает Express-приложение в функцию.
// Все обращения к /api/* и /health пробрасываются сюда через vercel.json.
import { createApp } from '../src/app.js';
import { ensureInitialized } from '../src/db.js';

let initPromise = null;
const app = createApp({ serveStatic: false });

export default async function handler(req, res) {
  if (!initPromise) initPromise = ensureInitialized();
  try {
    await initPromise;
  } catch (e) {
    initPromise = null;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database initialization failed', detail: e.message }));
    return;
  }
  return app(req, res);
}
