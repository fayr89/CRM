// Схема модуля «Поставки → Доставки» (ТЗ 18.07.2026). Все таблицы с префиксом
// sd_ и создаются ЛЕНИВО (idempotent CREATE TABLE IF NOT EXISTS) — не трогаем
// SCHEMA_VERSION/ensureInitialized, чтобы не влиять на холодный старт и боевой
// поток. ensureSupplyDeliverySchema() зовётся в начале data-эндпоинтов модуля.
//
// Phase 2a — справочники офиса:
//   sd_packaging_tariffs        — тарифы упаковки (тип, стоимость, норматив времени)
//   sd_packaging_tariff_history — история изменений тарифа (старые доставки НЕ
//                                 пересчитываются — расчёт снапшотит тариф на
//                                 момент, история нужна для аудита/прозрачности)
//   sd_stock_thresholds         — пороги остатков: глобальный ('default') + по SKU
// Вознаграждение склада хранится в app_settings['sd.warehouse_reward'].
import { db } from '../db.js';

let ensured = false;

export async function ensureSupplyDeliverySchema() {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_packaging_tariffs (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       cost REAL NOT NULL DEFAULT 0,
       time_norm_min REAL NOT NULL DEFAULT 0,
       active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_packaging_tariff_history (
       id SERIAL PRIMARY KEY,
       tariff_id INTEGER NOT NULL REFERENCES sd_packaging_tariffs(id) ON DELETE CASCADE,
       cost REAL NOT NULL,
       time_norm_min REAL NOT NULL,
       changed_by INTEGER,
       changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_stock_thresholds (
       sku TEXT PRIMARY KEY,
       threshold INTEGER NOT NULL DEFAULT 0,
       mode TEXT NOT NULL DEFAULT 'warn' CHECK (mode IN ('warn','block')),
       updated_by INTEGER,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS app_settings (
       key TEXT PRIMARY KEY, value JSONB NOT NULL,
       updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  );
  ensured = true;
}

export const REWARD_UNITS = ['per_order', 'per_item', 'per_hour'];
export const DEFAULT_REWARD = { amount: 0, unit: 'per_order' };

export async function getWarehouseReward() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'sd.warehouse_reward'`).catch(() => null);
  const v = row?.value;
  if (!v || typeof v !== 'object') return { ...DEFAULT_REWARD };
  return {
    amount: Number(v.amount) || 0,
    unit: REWARD_UNITS.includes(v.unit) ? v.unit : 'per_order',
  };
}

export async function setWarehouseReward(reward, userId) {
  await ensureSupplyDeliverySchema();
  const clean = {
    amount: Number(reward.amount) || 0,
    unit: REWARD_UNITS.includes(reward.unit) ? reward.unit : 'per_order',
  };
  await db.run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('sd.warehouse_reward', ?::jsonb, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    JSON.stringify(clean), userId,
  );
  return clean;
}
