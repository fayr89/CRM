// «🔄 Проверить остатки и зарезервировать» — для заказов в waiting_stock.
// Менеджер увидел в МС (или физически), что товар приехал, и хочет одной
// кнопкой: подтянуть свежие остатки по позициям этого заказа, и если
// хватает на orders.warehouse — сразу зарезервировать как через /reserve.
//
// Дублирует часть логики из orders.js /reserve (тот файл огромен, проще
// собрать узкий путь здесь и звать общие сервисы).
import { Router } from 'express';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';
import { msFetchStockByProductIds } from '../services/moysklad.js';
import { applyLocalStockReserveDelta } from '../services/ms-orders.js';
import { enqueueMsJob } from '../services/ms-jobs.js';
import { decryptSecret } from '../services/secrets.js';

const router = Router();
router.use(authenticate);

async function getMsToken() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'moysklad.token'`).catch(() => null);
  const stored = row?.value ? decryptSecret(row.value) : null;
  return stored || process.env.MOYSKLAD_TOKEN || null;
}

router.post(
  '/:id/recheck-stock',
  asyncHandler(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) throw NotFound('Заказ не найден');
    if (order.status !== 'waiting_stock') {
      throw BadRequest('Только для заказа в статусе «Ожидает товара»');
    }
    // Доступ: владелец заказа или admin/warehouse/aus/rop. Тот же набор что
    // у других переходов (см. orders.js).
    const role = req.user.role;
    const owner = order.manager_id === req.user.id;
    if (!owner && !['admin', 'warehouse', 'aus', 'rop'].includes(role)) {
      throw BadRequest('Нет прав на этот заказ');
    }
    const wh = (order.warehouse || '').trim();
    if (!wh) throw BadRequest('У заказа не задан «Склад списания» — без него проверять нечего');

    // 1) Тянем позиции с их продуктом и текущими stock_by_store.
    const items = await db.all(
      `SELECT oi.id, oi.name, oi.quantity, oi.product_id, oi.sku,
              p.external_source, p.external_id, p.stock_by_store
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`,
      order.id,
    );

    // 2) Свежие остатки из МС — только по тем товарам, у которых есть UUID.
    //    Для остальных используем то, что лежит в БД.
    const externalIds = [...new Set(items
      .filter((it) => it.external_source === 'moysklad' && it.external_id)
      .map((it) => it.external_id))];
    let refreshed = false;
    let msError = null;
    if (externalIds.length) {
      const token = await getMsToken();
      if (token) {
        try {
          const byId = await msFetchStockByProductIds(token, externalIds);
          // UPDATE products + локальное обновление item.stock_by_store
          for (const it of items) {
            if (!it.product_id || !it.external_id) continue;
            const sbs = byId.get(it.external_id);
            if (sbs && sbs.length) {
              await db.run(
                `UPDATE products SET stock_by_store = ?::jsonb, updated_at = NOW() WHERE id = ?`,
                JSON.stringify(sbs), it.product_id,
              );
              it.stock_by_store = sbs;
            }
          }
          refreshed = true;
        } catch (e) {
          msError = e.message;
        }
      }
    }

    // 3) Проверка наличия на orders.warehouse — как в /reserve.
    const issues = [];
    for (const it of items) {
      if (!it.product_id) continue;
      const sbs = Array.isArray(it.stock_by_store) ? it.stock_by_store
        : (typeof it.stock_by_store === 'string' ? JSON.parse(it.stock_by_store || '[]') : []);
      const row = sbs.find((e) => String(e.store || '').trim() === wh);
      const stock = Number(row?.stock) || 0;
      const reserve = Number(row?.reserve) || 0;
      const available = Math.max(0, stock - reserve);
      if (it.quantity > available) {
        issues.push({ name: it.name, sku: it.sku, qty: it.quantity, available });
      }
    }
    if (issues.length) {
      return res.json({
        ok: false,
        refreshed, ms_error: msError,
        reserved: false,
        message: `Не хватает товара на складе «${wh}» — заказ остаётся «Ожидает товара»`,
        missing: issues,
      });
    }

    // 4) Хватает — резервируем (упрощённая копия /reserve без shipment_qr-проверки:
    //    она нужна для маркетплейс-заказов в момент перехода new→reserved,
    //    но менеджер уже это поле заполнял когда заказ создавался; если нет —
    //    подскажем явно).
    if (order.marketplace && (!order.shipment_qr || !String(order.shipment_qr).trim())) {
      return res.json({
        ok: false, refreshed, reserved: false,
        message: 'Товар есть, но в заказе не заполнен «Номер отправления» — заполните и нажмите «Зарезервировать» вручную',
      });
    }
    await db.withTransaction(async (tx) => {
      await tx.run(
        `UPDATE orders SET status = 'reserved', warehouse_user_id = ?, reserved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        req.user.id, order.id,
      );
      const existing = await tx.get(
        `SELECT id FROM payments WHERE order_id = ? AND kind = 'income'`,
        order.id,
      );
      if (!existing && (order.total_amount || 0) > 0) {
        await tx.run(
          `INSERT INTO payments (manager_id, order_id, amount, currency, kind, status, notes, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'income', 'pending', ?, ?, NOW(), NOW())`,
          order.manager_id, order.id, order.total_amount, order.currency || 'RUB',
          `Заказ #${order.id}${order.marketplace ? ' · ' + order.marketplace : ''}`,
          order.project_id ?? null,
        );
      }
    });
    try { await applyLocalStockReserveDelta(order.id, 0, +1); } catch { /* ignore */ }
    await enqueueMsJob(order.id, 'customer_order.upsert', { reserve_mode: 'full' });
    await logAction(req, {
      action: 'order.reserved',
      entity_type: 'order',
      entity_id: order.id,
      details: { from: 'recheck-stock', refreshed_from_ms: refreshed },
    });
    res.json({
      ok: true, refreshed, ms_error: msError,
      reserved: true, status: 'reserved',
      message: 'Товар есть — заказ зарезервирован',
    });
  }),
);

export default router;
