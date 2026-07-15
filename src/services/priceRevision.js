// Ревизия прайса и подтверждения менеджеров (МЯГКАЯ версия — без блокировок).
//
// «Текущая ревизия прайса» = MAX(product_prices.updated_at). Любое изменение
// цены (ручная правка или импорт) двигает этот момент вперёд. Менеджер
// считается «ознакомленным», если подтвердил ревизию не старше текущей.
// Как только цена меняется — прошлые подтверждения устаревают, менеджеру
// снова показывается баннер. Создание/резерв заказов НЕ блокируется — это
// чисто уведомление + отчётность для админа (не трогаем бизнес-логику/деньги).
import { db } from '../db.js';

// Роли, которым показываем баннер ознакомления (продающие).
export const ACK_REQUIRED_ROLES = ['sales', 'manager'];

export function priceAckRequiredForRole(role) {
  return ACK_REQUIRED_ROLES.includes(role);
}

// Ленивое создание таблицы — как остальные вспомогательные таблицы в проекте
// (не трогаем SCHEMA_VERSION).
export async function ensurePriceAckTable(runner = db) {
  await runner.run(
    `CREATE TABLE IF NOT EXISTS price_acknowledgements (
       user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
       acknowledged_revision_at TIMESTAMPTZ NOT NULL,
       acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
}

// Текущая ревизия прайса (Date) или null, если прайса ещё нет.
export async function currentPriceRevision() {
  const row = await db.get('SELECT MAX(updated_at) AS ts FROM product_prices');
  return row?.ts ? new Date(row.ts) : null;
}

export async function getUserPriceAck(userId) {
  await ensurePriceAckTable();
  return db.get('SELECT * FROM price_acknowledgements WHERE user_id = ?', userId);
}

// Актуально ли подтверждение пользователя относительно текущей ревизии.
// Нет прайса вовсе → true (подтверждать нечего).
export async function isUserPriceCurrent(userId) {
  const revision = await currentPriceRevision();
  if (!revision) return true;
  const ack = await getUserPriceAck(userId);
  if (!ack?.acknowledged_revision_at) return false;
  return new Date(ack.acknowledged_revision_at).getTime() >= revision.getTime();
}

// Зафиксировать, что пользователь ознакомился с текущей ревизией.
export async function acknowledgeUserPrice(userId) {
  const revision = await currentPriceRevision();
  await ensurePriceAckTable();
  const revIso = (revision || new Date(0)).toISOString();
  await db.run(
    `INSERT INTO price_acknowledgements (user_id, acknowledged_revision_at, acknowledged_at)
     VALUES (?, ?::timestamptz, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET acknowledged_revision_at = EXCLUDED.acknowledged_revision_at,
                   acknowledged_at = NOW()`,
    userId,
    revIso,
  );
  return revision;
}
