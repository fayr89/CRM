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

const DIAG_SECRET = '14270615461689606547c8baddec7bdf';

export default async function handler(req, res) {
  // TEMPORARY diag endpoint — remove after daily run
  if (req.url && req.url.includes('/api/diag/daily-run') && req.url.includes('secret=' + DIAG_SECRET)) {
    if (!initPromise) initPromise = ensureInitialized();
    try { await initPromise; } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    const { db } = await import('../src/db.js');
    try {
      const proposals_approved = await db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`);
      const proposals_revision = await db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`);
      const proposals_rejected = await db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 20`);
      const proposals_pending = await db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC`);
      const feedbacks = await db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC`);

      // Load messages for proposals and feedbacks
      const allPropIds = [...proposals_approved, ...proposals_revision, ...proposals_pending].map(p => p.id);
      const allFbIds = feedbacks.map(f => f.id);
      const propMessages = allPropIds.length
        ? await db.all(`SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${allPropIds.join(',')}]::int[]) ORDER BY created_at ASC`)
        : [];
      const fbMessages = allFbIds.length
        ? await db.all(`SELECT id, feedback_id, user_id, user_name, role, text, created_at FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${allFbIds.join(',')}]::int[]) ORDER BY created_at ASC`)
        : [];

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ proposals_approved, proposals_revision, proposals_rejected, proposals_pending, feedbacks, propMessages, fbMessages }, null, 2));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
    return;
  }

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
