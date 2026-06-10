// Vercel serverless entry: оборачивает Express-приложение в функцию.
// Все обращения к /api/* и /health пробрасываются сюда через vercel.json.
import { createApp } from '../src/app.js';
import { ensureInitialized } from '../src/db.js';

// TEMP: daily AI diag endpoint 2026-06-10-v32 (remove after use)
const _DIAG_SECRET = 'jR4tW8mZqK';
const _DIAG_BASE = '/api/diag/2026-06-10-v32';
async function _handleDiag(req, res) {
  const { db } = await import('../src/db.js');
  const rawUrl = req.url || '';
  const parsed = new URL(rawUrl, 'http://localhost');
  if (parsed.searchParams.get('secret') !== _DIAG_SECRET) {
    res.statusCode = 403; res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({error:'forbidden'})); return;
  }
  const isWrite = rawUrl.includes('/write');
  if (!isWrite) {
    // READ: proposals (all statuses) + messages + feedback + threads
    const proposals = await db.all(`SELECT p.*, f.subject AS feedback_subject FROM ai_proposals p LEFT JOIN feedback f ON f.id=p.feedback_id ORDER BY p.created_at DESC LIMIT 200`);
    for (const p of proposals) {
      p.messages = await db.all(`SELECT * FROM ai_proposal_messages WHERE proposal_id=$1 ORDER BY created_at`, p.id);
    }
    const feedbacks = await db.all(`SELECT f.*, u.name AS user_name_join FROM feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.status IN ('open','awaiting_approval') ORDER BY f.created_at DESC LIMIT 200`);
    for (const f of feedbacks) {
      f.thread = await db.all(`SELECT * FROM feedback_messages WHERE feedback_id=$1 ORDER BY created_at`, f.id);
    }
    res.statusCode = 200; res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({proposals, feedbacks})); return;
  }
  // WRITE via GET
  const p = parsed.searchParams;
  const action = p.get('action');
  let result;
  if (action === 'patch_proposal') {
    const id = p.get('id'); const decision = p.get('decision');
    const notes = p.get('admin_notes') || null; const summary = p.get('summary') || null;
    const pc = p.get('proposed_changes') || null;
    const sets = ['status=$2','updated_at=NOW()'];
    const vals = [id, decision];
    if (notes) { vals.push(notes); sets.push(`admin_notes=$${vals.length}`); }
    if (summary) { vals.push(summary); sets.push(`summary=$${vals.length}`); }
    if (pc) { vals.push(pc); sets.push(`proposed_changes=$${vals.length}::jsonb`); }
    await db.run(`UPDATE ai_proposals SET ${sets.join(',')} WHERE id=$1`, ...vals);
    result = {ok:true, action, id, decision};
  } else if (action === 'post_proposal_msg') {
    const pid = p.get('proposal_id'); const text = p.get('text');
    const r = await db.run(`INSERT INTO ai_proposal_messages(proposal_id,user_name,role,text,created_at) VALUES($1,'AI ассистент','admin',$2,NOW()) RETURNING id`, pid, text);
    result = {ok:true, action, id: r?.id};
  } else if (action === 'post_proposal') {
    const title = p.get('title'); const summary = p.get('summary');
    const category = p.get('category')||'feature'; const risk = p.get('risk')||'medium';
    const source = p.get('source')||'daily-run-2026-06-10';
    const fid = p.get('feedback_id') ? Number(p.get('feedback_id')) : null;
    const pc = p.get('proposed_changes')||'[]';
    const r = await db.run(
      `INSERT INTO ai_proposals(feedback_id,title,summary,category,risk,source,proposed_changes,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'pending',NOW(),NOW()) RETURNING id`,
      fid, title, summary, category, risk, source, pc
    );
    result = {ok:true, action, id: r?.id};
  } else if (action === 'patch_feedback') {
    const id = p.get('id'); const status = p.get('status');
    const reply = p.get('admin_reply') || null;
    if (reply !== null) {
      await db.run(`UPDATE feedback SET status=$2, admin_reply=$3, updated_at=NOW() WHERE id=$1`, id, status, reply);
    } else {
      await db.run(`UPDATE feedback SET status=$2, updated_at=NOW() WHERE id=$1`, id, status);
    }
    result = {ok:true, action, id, status};
  } else if (action === 'post_feedback_msg') {
    const fid = p.get('feedback_id'); const text = p.get('text');
    const r = await db.run(`INSERT INTO feedback_messages(feedback_id,user_name,role,text,created_at) VALUES($1,'AI ассистент','admin',$2,NOW()) RETURNING id`, fid, text);
    result = {ok:true, action, id: r?.id};
  } else {
    result = {error:`unknown action: ${action}`};
  }
  res.statusCode = 200; res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(result));
}
// END TEMP diag

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
  // TEMP diag intercept 2026-06-10-v32
  if (req.url && (req.url === _DIAG_BASE || req.url.startsWith(_DIAG_BASE + '?') || req.url.startsWith(_DIAG_BASE + '/'))) {
    return _handleDiag(req, res).catch(e => { res.statusCode = 500; res.end(JSON.stringify({error: e.message})); });
  }
  return app(req, res);
}
