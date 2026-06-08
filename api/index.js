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

// TEMPORARY diag for daily AI run v30 — remove after use
const DIAG_S = 'run30-c7e2a9f4b1d8';

export default async function handler(req, res) {
  const rawUrl = req.url || '';
  if (rawUrl.includes('/api/diag/daily-run') && rawUrl.includes('s=' + DIAG_S)) {
    const qi = rawUrl.indexOf('?');
    const pathOnly = qi >= 0 ? rawUrl.slice(0, qi) : rawUrl;
    const params = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : '');
    if (!initPromise) initPromise = ensureInitialized();
    try { await initPromise; } catch (e) {
      initPromise = null;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
    const { db } = await import('../src/db.js');
    const j = (o, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o, null, 2)); };
    try {
      if (pathOnly.endsWith('/w/fb-msg')) {
        const id = Number(params.get('id')); const text = params.get('text') || '';
        if (!id || !text) { j({ error: 'id and text required' }, 400); return; }
        await db.run(`INSERT INTO feedback_messages (feedback_id, user_id, user_name, role, text) VALUES (?, NULL, 'AI ассистент', 'admin', ?)`, id, text);
        j({ ok: true });
      } else if (pathOnly.endsWith('/w/fb-status')) {
        const id = Number(params.get('id')); const status = params.get('status') || ''; const reply = params.get('reply') || null;
        if (!id || !status) { j({ error: 'id and status required' }, 400); return; }
        const cur = await db.get('SELECT * FROM feedback WHERE id = ?', id);
        if (!cur) { j({ error: 'not found' }, 404); return; }
        const justResolved = (status === 'awaiting_approval' || status === 'closed') && cur.status !== 'awaiting_approval' && cur.status !== 'closed';
        await db.run(`UPDATE feedback SET status = ?, admin_reply = COALESCE(?, admin_reply), resolved_at = ${justResolved ? 'NOW()' : 'resolved_at'}, updated_at = NOW() WHERE id = ?`, status, reply, id);
        j(await db.get('SELECT id, status, admin_reply FROM feedback WHERE id = ?', id));
      } else if (pathOnly.endsWith('/w/proposal-status')) {
        const id = Number(params.get('id')); const decision = params.get('decision') || '';
        if (!id || !decision) { j({ error: 'id and decision required' }, 400); return; }
        await db.run(`UPDATE ai_proposals SET status = ?, updated_at = NOW() WHERE id = ?`, decision, id);
        j(await db.get('SELECT id, status FROM ai_proposals WHERE id = ?', id));
      } else if (pathOnly.endsWith('/w/proposal-msg')) {
        const id = Number(params.get('id')); const text = params.get('text') || '';
        if (!id || !text) { j({ error: 'id and text required' }, 400); return; }
        await db.run(`INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text, created_at) VALUES (?, NULL, 'AI ассистент', 'ai', ?, NOW())`, id, text);
        j({ ok: true });
      } else if (pathOnly.endsWith('/w/new-proposal')) {
        const title = params.get('title') || ''; const summary = params.get('summary') || '';
        const category = params.get('category') || 'feature'; const risk = params.get('risk') || 'medium';
        const fid = params.get('fid') ? Number(params.get('fid')) : null;
        const r = await db.run(`INSERT INTO ai_proposals (title, summary, category, risk, source, feedback_id, proposed_changes, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'daily-run-2026-06-08-v30', ?, '[]'::jsonb, 'pending', NOW(), NOW()) RETURNING id`, title, summary, category, risk, fid);
        j({ id: r.lastInsertRowid, ok: true });
      } else {
        // Main data dump
        const proposals_approved = await db.all(`SELECT * FROM ai_proposals WHERE status = 'approved' ORDER BY created_at DESC`);
        const proposals_revision = await db.all(`SELECT * FROM ai_proposals WHERE status = 'revision' ORDER BY created_at DESC`);
        const proposals_rejected = await db.all(`SELECT * FROM ai_proposals WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 20`);
        const proposals_pending = await db.all(`SELECT * FROM ai_proposals WHERE status = 'pending' ORDER BY created_at DESC`);
        const feedbacks = await db.all(`SELECT f.*, u.name AS user_name, u.email AS user_email, u.role AS user_role FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC`);
        const allPropIds = [...proposals_approved, ...proposals_revision, ...proposals_pending].map(p => p.id);
        const allFbIds = feedbacks.map(f => f.id);
        const propMessages = allPropIds.length ? await db.all(`SELECT * FROM ai_proposal_messages WHERE proposal_id = ANY(ARRAY[${allPropIds.join(',')}]::int[]) ORDER BY created_at ASC`) : [];
        const fbMessages = allFbIds.length ? await db.all(`SELECT id, feedback_id, user_id, user_name, role, LEFT(text,500) AS text, created_at FROM feedback_messages WHERE feedback_id = ANY(ARRAY[${allFbIds.join(',')}]::int[]) ORDER BY created_at ASC`) : [];
        j({ proposals_approved, proposals_revision, proposals_rejected, proposals_pending, feedbacks, propMessages, fbMessages });
      }
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
