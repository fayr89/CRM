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
  // ----- Phase 2b: сущности Поставка / Доставка -----
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_supplies (
       id SERIAL PRIMARY KEY,
       channel TEXT NOT NULL DEFAULT 'wb',
       model TEXT NOT NULL DEFAULT 'fbs',
       legal_entity TEXT,
       title TEXT,
       status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_work','shipped')),
       note TEXT,
       created_by INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_supply_items (
       id SERIAL PRIMARY KEY,
       supply_id INTEGER NOT NULL REFERENCES sd_supplies(id) ON DELETE CASCADE,
       sku TEXT,
       name TEXT,
       quantity INTEGER NOT NULL DEFAULT 1,
       product_id INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_deliveries (
       id SERIAL PRIMARY KEY,
       title TEXT,
       status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed')),
       logistics_cost REAL NOT NULL DEFAULT 0,
       created_by INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       closed_at TIMESTAMPTZ
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_delivery_supplies (
       delivery_id INTEGER NOT NULL REFERENCES sd_deliveries(id) ON DELETE CASCADE,
       supply_id INTEGER NOT NULL REFERENCES sd_supplies(id) ON DELETE CASCADE,
       PRIMARY KEY (delivery_id, supply_id)
     )`,
  );
  // Позиции упаковки доставки — снапшот тарифа на момент добавления (старые
  // доставки не пересчитываются при изменении справочника).
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_delivery_packaging (
       id SERIAL PRIMARY KEY,
       delivery_id INTEGER NOT NULL REFERENCES sd_deliveries(id) ON DELETE CASCADE,
       tariff_id INTEGER,
       tariff_name TEXT,
       unit_cost REAL NOT NULL DEFAULT 0,
       unit_time_min REAL NOT NULL DEFAULT 0,
       quantity INTEGER NOT NULL DEFAULT 1,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  // Каналы + юрлица + API-ключи (ключи заводит только админ; один канал = один
  // менеджер канала). api_key_enc — зашифрован через services/secrets.js.
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_channel_accounts (
       id SERIAL PRIMARY KEY,
       channel TEXT NOT NULL,
       legal_entity TEXT,
       api_key_enc TEXT,
       manager_id INTEGER,
       active BOOLEAN NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  // Упаковка: вместо норматива времени — единица измерения (шт/м/рулон…).
  // Габариты упакованного изделия и расход упаковки — на уровне товара
  // (продуктовый справочник, отдельный шаг). Старую колонку time_norm_min
  // оставляем ради обратной совместимости, но не используем.
  await db.run(`ALTER TABLE sd_packaging_tariffs ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'шт'`);
  ensured = true;
}

// Ставка труда склада (₽/мин) — стоимость времени упаковки. Отдельно от
// «вознаграждения» (то — доход склада, это — его расход на зарплату).
export async function getLaborRatePerMin() {
  const row = await db.get(`SELECT value FROM app_settings WHERE key = 'sd.labor_rate_per_min'`).catch(() => null);
  return Number(row?.value) || 0;
}

export async function setLaborRatePerMin(rate, userId) {
  await ensureSupplyDeliverySchema();
  const clean = Math.max(0, Number(rate) || 0);
  await db.run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('sd.labor_rate_per_min', ?::jsonb, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    JSON.stringify(clean), userId,
  );
  return clean;
}

// Финмодель доставки: прибыль склада = вознаграждение − (упаковка + обработка
// позиций складом + логистика). Себестоимость товара НЕ входит (прибыль склада
// как обособленного центра). «Обработка позиций» (расход склада за позицию,
// задаёт офис) появится вместе с продуктовым справочником — пока 0.
export function computeDeliveryFinance({ delivery, packaging, reward, itemStats, handlingCost }) {
  const packaging_cost = (packaging || []).reduce((s, p) => s + (Number(p.unit_cost) || 0) * (Number(p.quantity) || 0), 0);
  const handling_cost = Number(handlingCost) || 0;
  const logistics_cost = Number(delivery?.logistics_cost) || 0;
  let reward_base = 0;
  if (reward?.unit === 'per_item') reward_base = itemStats?.total_qty || 0;
  else if (reward?.unit === 'per_order') reward_base = itemStats?.supply_count || 0;
  // per_hour временно неактуален (учёт времени убран) → база 0.
  const reward_amount = (Number(reward?.amount) || 0) * reward_base;
  const net_profit = reward_amount - (packaging_cost + handling_cost + logistics_cost);
  return {
    packaging_cost: round2(packaging_cost),
    handling_cost: round2(handling_cost),
    logistics_cost: round2(logistics_cost),
    reward_unit: reward?.unit || 'per_order',
    reward_base: round2(reward_base),
    reward_amount: round2(reward_amount),
    net_profit: round2(net_profit),
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

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
