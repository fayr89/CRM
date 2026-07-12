// TEMP diag endpoint: reconciliation for ai_proposal #62 (ship-bulk silent-fail).
// Read-only reconciliation against real МойСклад state before any retroactive
// demand.create, to avoid double stock deduction for orders a warehouse worker
// may have already shipped manually in МС outside the CRM flow.
// Remove after use (daily-run 2026-07-12).
import { Router } from 'express';
import { db } from '../db.js';
import { getMoyskladToken } from '../services/ms-jobs.js';
import { enqueueMsJob } from '../services/ms-jobs.js';

const router = Router();
const SECRET = 'ms-reconcile-v290-9c2e4a7f1b6d3085';

const BASE = 'https://api.moysklad.ru/api/remap/1.2';

router.use(async (req, res, next) => {
  const secret = req.query.secret || req.body?.secret;
  if (secret !== SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// filter=customerOrder=<href> on /entity/demand is rejected by МС (error 1034,
// unknown filtration field) — customerOrder isn't a filterable field there.
// Reliable signal instead: the customerorder entity itself carries shippedSum
// (updated whenever ANY demand — CRM-created or manually created in the МС UI —
// ships against it). shippedSum > 0 means stock was already physically
// deducted for this order, regardless of who created the demand.
async function fetchCustomerOrderShippedState(token, customerOrderId) {
  const url = `${BASE}/entity/customerorder/${customerOrderId}?expand=positions`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${String(token).trim()}`, Accept: 'application/json;charset=utf-8' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`МС customerorder ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  return { shippedSum: data.shippedSum || 0, sum: data.sum || 0, demandsHref: data.demands?.meta?.href || null };
}

// Resolve the actual demand id(s) linked to a customer order (for bookkeeping
// only — link-existing never writes to МС, just records locally).
async function fetchLinkedDemandIds(token, demandsHref) {
  if (!demandsHref) return [];
  const res = await fetch(`${demandsHref}?limit=10`, {
    headers: { Authorization: `Bearer ${String(token).trim()}`, Accept: 'application/json;charset=utf-8' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.rows || []).map((d) => d.id);
}

router.get('/', async (req, res) => {
  const op = req.query.op;
  try {
    if (op === 'raw-order') {
      const token = await getMoyskladToken();
      if (!token) return res.json({ ok: false, error: 'МС токен не настроен' });
      const id = req.query.ms_id;
      const url = `${BASE}/entity/customerorder/${id}?expand=positions`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${String(token).trim()}`, Accept: 'application/json;charset=utf-8' },
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ ok: false, status: r.status, body: text.slice(0, 2000) });
      const data = JSON.parse(text);
      return res.json({
        ok: true,
        id: data.id,
        name: data.name,
        sum: data.sum,
        shippedSum: data.shippedSum,
        payedSum: data.payedSum,
        state: data.state?.meta?.href,
        demands_raw: data.demands,
        positions_summary: (data.positions?.rows || []).map((p) => ({
          quantity: p.quantity,
          shipped: p.shipped,
          reserve: p.reserve,
        })),
        all_top_level_keys: Object.keys(data),
      });
    }

    if (op === 'candidates') {
      const rows = await db.all(
        `SELECT o.id, o.status, o.shipped_at, o.ms_customer_order_id, o.reference_number
         FROM orders o
         WHERE o.status IN ('shipped','completed')
           AND o.ms_demand_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM ms_jobs j WHERE j.order_id = o.id AND j.action = 'demand.create')
         ORDER BY o.id ASC`,
      );
      return res.json({ ok: true, count: rows.length, data: rows });
    }

    if (op === 'check') {
      // Read-only: for each candidate with ms_customer_order_id, ask МС if a demand
      // already exists for that customer order. No writes anywhere.
      const token = await getMoyskladToken();
      if (!token) return res.json({ ok: false, error: 'МС токен не настроен' });
      const allRows = await db.all(
        `SELECT o.id, o.ms_customer_order_id
         FROM orders o
         WHERE o.status IN ('shipped','completed')
           AND o.ms_demand_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM ms_jobs j WHERE j.order_id = o.id AND j.action = 'demand.create')
         ORDER BY o.id ASC`,
      );
      // Chunked: 151 sequential МС calls exceeds serverless function timeout,
      // so allow checking a slice at a time via offset/count.
      const offset = Number(req.query.offset || 0);
      const count = Number(req.query.count || allRows.length);
      const rows = allRows.slice(offset, offset + count);
      const noCustomerOrder = rows.filter((r) => !r.ms_customer_order_id).map((r) => r.id);
      const toCheck = rows.filter((r) => r.ms_customer_order_id);
      const alreadyShipped = [];
      const confirmedMissing = [];
      const errors = [];
      for (const r of toCheck) {
        try {
          const st = await fetchCustomerOrderShippedState(token, r.ms_customer_order_id);
          if (st.shippedSum > 0) {
            const demandIds = await fetchLinkedDemandIds(token, st.demandsHref);
            alreadyShipped.push({
              order_id: r.id,
              shippedSum: st.shippedSum,
              sum: st.sum,
              demand_id: demandIds[0] || null,
              demand_count: demandIds.length,
            });
          } else {
            confirmedMissing.push(r.id);
          }
        } catch (e) {
          errors.push({ order_id: r.id, error: e.message });
        }
      }
      return res.json({
        ok: true,
        total_candidates: allRows.length,
        checked_this_batch: rows.length,
        offset,
        no_customer_order_id: noCustomerOrder,
        already_shipped_in_ms: alreadyShipped,
        confirmed_missing: confirmedMissing,
        errors,
      });
    }

    if (op === 'link-existing') {
      // For orders where МС already has a demand (manually shipped outside CRM):
      // just record ms_demand_id locally. No МС write, no stock re-deduction.
      const pairs = JSON.parse(req.query.pairs || '[]'); // [{order_id, demand_id}]
      const results = [];
      for (const { order_id, demand_id } of pairs) {
        await db.run('UPDATE orders SET ms_demand_id = ? WHERE id = ?', demand_id, order_id);
        results.push(order_id);
      }
      return res.json({ ok: true, linked: results });
    }

    if (op === 'fix-missing') {
      // For confirmed-missing orders only: run the real (idempotent) demand.create
      // job, same code path as normal /ship. This is the actual retroactive fix.
      const ids = JSON.parse(req.query.ids || '[]');
      const results = [];
      for (const id of ids) {
        try {
          const r = await enqueueMsJob(id, 'demand.create');
          const order = await db.get('SELECT id, ms_demand_id FROM orders WHERE id = ?', id);
          results.push({ order_id: id, job: r, ms_demand_id: order?.ms_demand_id || null });
        } catch (e) {
          results.push({ order_id: id, error: e.message });
        }
      }
      return res.json({ ok: true, data: results });
    }

    return res.json({ ok: false, error: 'unknown op' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
