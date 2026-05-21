import crypto from 'node:crypto';
import { db } from '../db.js';

// Огонь-и-забыли: эмитим событие в фоне, не задерживая HTTP-ответ.
// Если webhook упал — записываем ошибку в webhook_deliveries.
export function emitEvent(event, payload) {
  setImmediate(async () => {
    try {
      const hooks = await db.all(
        `SELECT * FROM webhooks WHERE active = TRUE
         AND (events = '*' OR events LIKE ? OR events LIKE ? OR events LIKE ? OR events = ?)`,
        `${event},%`,
        `%,${event},%`,
        `%,${event}`,
        event,
      );
      for (const hook of hooks) {
        await deliver(hook, event, payload);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[webhooks] emit error', e);
    }
  });
}

async function deliver(hook, event, payload) {
  const body = JSON.stringify({ event, payload, ts: new Date().toISOString() });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'CRM-Webhook/1.0' };
  if (hook.secret) {
    const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
    headers['X-CRM-Signature'] = `sha256=${sig}`;
  }
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    await db.run(
      `INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code)
       VALUES (?, ?, ?, ?)`,
      hook.id,
      event,
      body,
      res.status,
    );
  } catch (e) {
    await db.run(
      `INSERT INTO webhook_deliveries (webhook_id, event, payload, error)
       VALUES (?, ?, ?, ?)`,
      hook.id,
      event,
      body,
      String(e.message || e).slice(0, 500),
    );
  }
}
