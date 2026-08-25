// Уведомления о движениях остатков по складу. При событии (резерв/отгрузка/
// поступление) вызывается notifyStockMovement — читает подписчиков склада
// из user_stock_watches и отправляет им push+MAX через сервис notify().
//
// Одна функция для всех источников движений (заказы, материалы, подряды).
// Kind ∈ 'reserve' | 'ship' | 'receipt'.

import { notify } from './notifications.js';

// Загружаем db лениво чтобы не было цикла с notifications.js → db.
async function getDb() {
  const mod = await import('../db.js');
  return mod.db;
}

const KIND_LABELS = {
  reserve: '📦 Резерв',
  ship: '🚚 Списание (отгрузка)',
  receipt: '📥 Поступление',
};
const KIND_FIELD = {
  reserve: 'watch_reserve',
  ship: 'watch_ship',
  receipt: 'watch_receipt',
};

// Короткое имя склада для заголовка push (в мобильном превью 60 символов).
function shortWarehouse(name) {
  if (!name) return '';
  // Убираем скобочные пояснения и «Склад НСК» → просто выделяем ключевое слово.
  return name.replace(/^Склад\s+/, '').slice(0, 30);
}

export async function notifyStockMovement(warehouse, kind, ctx = {}) {
  if (!warehouse) return;
  if (!KIND_LABELS[kind]) return;
  const db2 = await getDb();
  const field = KIND_FIELD[kind];
  let subscribers;
  try {
    subscribers = await db2.all(
      `SELECT u.id, u.email FROM user_stock_watches w
       JOIN users u ON u.id = w.user_id AND u.active = TRUE
       WHERE w.warehouse = ? AND w.${field} = TRUE`,
      warehouse,
    );
  } catch { return; }
  if (!subscribers.length) return;
  const label = KIND_LABELS[kind];
  // Заголовок: КЛИЕНТ вытянут вперёд (в мобильном push превью видно только его).
  //   ship / reserve / receipt из заказа → «🚚 Списание · Иванов И.И. · Склад НСК»
  // Если клиента нет — «... · Склад НСК».
  const titleParts = [label];
  if (ctx.clientName) titleParts.push(`🧑 ${ctx.clientName}`);
  titleParts.push(shortWarehouse(warehouse));
  const title = titleParts.join(' · ');
  // Тело: детали.
  const bodyParts = [];
  if (ctx.orderId) bodyParts.push(`Заказ #${ctx.orderId}`);
  if (ctx.amount) bodyParts.push(`💰 ${Number(ctx.amount).toLocaleString('ru-RU')} ₽`);
  if (ctx.marketplace) bodyParts.push(`🛒 ${ctx.marketplace}`);
  bodyParts.push(`📍 ${warehouse}`); // полное имя склада — в теле
  if (ctx.itemsPreview) bodyParts.push('\n' + ctx.itemsPreview);
  const body = bodyParts.join(' · ');
  const link = ctx.orderId ? `#/orders?id=${ctx.orderId}` : (ctx.link || '#/orders');
  for (const s of subscribers) {
    await notify(s.id, `stock.${kind}`, title, body, link).catch(() => {});
  }
}
