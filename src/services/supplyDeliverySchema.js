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
  await db.run(`ALTER TABLE sd_packaging_tariffs ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'шт'`);
  // Продуктовый справочник на базе номенклатуры МойСклада (products).
  // На позицию: тип упаковки + расход упаковки (сколько уходит) + время
  // упаковки (мин, для зарплаты = время × ставка ₽/мин) + габариты
  // упакованного изделия. Ключ — product_id (внутренняя номенклатура).
  // Колонки под matching с каналом (channel_sku по каналам) — отдельная
  // таблица sd_product_channel_map, добавится при интеграции канала (Phase 3).
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_product_directory (
       product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
       packaging_tariff_id INTEGER,
       packaging_consumption REAL NOT NULL DEFAULT 0,
       packing_time_min REAL NOT NULL DEFAULT 0,
       dim_l REAL, dim_w REAL, dim_h REAL,
       updated_by INTEGER,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  // Matching номенклатуры канала ⇄ внутренней (МойСклад). Одна строка = товар
  // канала (штрихкод/артикул канала), сопоставленный с внутренним product_id.
  // Источник — ручной импорт или подтяжка по API канала (WB и т.д.).
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_product_channel_map (
       id SERIAL PRIMARY KEY,
       channel TEXT NOT NULL,
       channel_barcode TEXT,
       channel_sku TEXT,
       channel_name TEXT,
       channel_extra JSONB,
       product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
       matched_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_sd_channel_map
     ON sd_product_channel_map (channel, COALESCE(channel_barcode, ''), COALESCE(channel_sku, ''))`,
  );
  // «Книга сетов»: сет = артикул маркетплейса (комбинация артикулов склада).
  // Упаковка и габариты — на СЕТЕ (а не на товаре склада), т.к. пакуется именно
  // маркетплейс-артикул. Один сет ↔ разные канальные SKU (см. channel_map.set_id).
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_sets (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       packaging_tariff_id INTEGER,
       packaging_consumption REAL NOT NULL DEFAULT 0,
       packing_time_min REAL NOT NULL DEFAULT 0,
       dim_l REAL, dim_w REAL, dim_h REAL,
       created_by INTEGER,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_set_components (
       id SERIAL PRIMARY KEY,
       set_id INTEGER NOT NULL REFERENCES sd_sets(id) ON DELETE CASCADE,
       product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
       quantity REAL NOT NULL DEFAULT 1
     )`,
  );
  // Упаковка сета — МНОГО типов на один сет (напр. стретч-плёнка + коробка).
  // Каждая строка: тариф упаковки (тип + ед.изм + цена) + расход в его единицах.
  // Стоимость упаковки сета = Σ (расход × цена тарифа).
  await db.run(
    `CREATE TABLE IF NOT EXISTS sd_set_packaging (
       id SERIAL PRIMARY KEY,
       set_id INTEGER NOT NULL REFERENCES sd_sets(id) ON DELETE CASCADE,
       packaging_tariff_id INTEGER,
       consumption REAL NOT NULL DEFAULT 0,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  // Одноразовая миграция старой одиночной упаковки (sd_sets.packaging_tariff_id/
  // packaging_consumption) в строки sd_set_packaging. Флаг packaging_migrated
  // гарантирует, что удалённые строки не воскресают при повторном холодном старте.
  await db.run('ALTER TABLE sd_sets ADD COLUMN IF NOT EXISTS packaging_migrated BOOLEAN NOT NULL DEFAULT FALSE');
  await db.run(
    `INSERT INTO sd_set_packaging (set_id, packaging_tariff_id, consumption)
     SELECT id, packaging_tariff_id, COALESCE(packaging_consumption, 0)
     FROM sd_sets WHERE packaging_tariff_id IS NOT NULL AND packaging_migrated IS NOT TRUE`,
  );
  await db.run('UPDATE sd_sets SET packaging_migrated = TRUE WHERE packaging_migrated IS NOT TRUE');
  // Артикул сета = ключ маппинга с артикулом маркетплейса (WB=артикул продавца,
  // Ozon=штрихкод, ЯМ=SKU). ms_bundle_id — UUID комплекта в МойСклад (для синка).
  await db.run('ALTER TABLE sd_sets ADD COLUMN IF NOT EXISTS article TEXT');
  await db.run('ALTER TABLE sd_sets ADD COLUMN IF NOT EXISTS ms_bundle_id TEXT');
  await db.run('ALTER TABLE sd_sets ADD COLUMN IF NOT EXISTS ms_synced_at TIMESTAMPTZ');
  // Вознаграждение склада — теперь на КАЖДОМ сете (свой «тариф»), а не глобально.
  await db.run('ALTER TABLE sd_sets ADD COLUMN IF NOT EXISTS warehouse_reward REAL');
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS sd_sets_ms_bundle_id_uidx ON sd_sets (ms_bundle_id) WHERE ms_bundle_id IS NOT NULL');
  // Сопоставление канал-SKU → сет (а не → товар склада).
  await db.run('ALTER TABLE sd_product_channel_map ADD COLUMN IF NOT EXISTS set_id INTEGER');
  // Из какого канал-аккаунта (юрлица/ключа) подтянута номенклатура — чтобы
  // тянуть/фильтровать по конкретному каналу, а не только по первому.
  await db.run('ALTER TABLE sd_product_channel_map ADD COLUMN IF NOT EXISTS channel_account_id INTEGER');
  // Скрытие строк из рабочего списка (таблица разрослась, с телефона не удобно).
  await db.run('ALTER TABLE sd_product_channel_map ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE');
  // WB ФБС: поставке нужен внешний supplyId WB + привязка к каналу (для ключа),
  // позиции = сборочные задания WB (external_order_id + штрихкод).
  await db.run('ALTER TABLE sd_supplies ADD COLUMN IF NOT EXISTS channel_account_id INTEGER');
  await db.run('ALTER TABLE sd_supplies ADD COLUMN IF NOT EXISTS external_supply_id TEXT');
  await db.run('ALTER TABLE sd_supplies ADD COLUMN IF NOT EXISTS external_status TEXT');
  await db.run('ALTER TABLE sd_supply_items ADD COLUMN IF NOT EXISTS external_order_id TEXT');
  await db.run('ALTER TABLE sd_supply_items ADD COLUMN IF NOT EXISTS barcode TEXT');
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

// Финмодель доставки: прибыль склада = начисление офиса (вознаграждение) −
// (упаковка + зарплата + логистика). Упаковка и зарплата ДЕРИВАЮТСЯ из позиций
// доставки × продуктовый справочник (расход упаковки × цена ед.; время × ставка
// ₽/мин). Себестоимость товара НЕ входит (прибыль склада как обособл. центра).
// packagingCost и laborMinutes считает вызывающий (SQL по позициям).
// rewardTotal — сумма вознаграждений по сетам позиций доставки (Σ set.warehouse_reward
// × кол-во). Вознаграждение теперь задаётся НА СЕТЕ, а не глобально.
export function computeDeliveryFinance({ delivery, packagingCost, laborMinutes, laborRatePerMin, rewardTotal }) {
  const packaging_cost = Number(packagingCost) || 0;
  const labor_minutes = Number(laborMinutes) || 0;
  const labor_cost = labor_minutes * (Number(laborRatePerMin) || 0);
  const logistics_cost = Number(delivery?.logistics_cost) || 0;
  const reward_amount = Number(rewardTotal) || 0;
  const net_profit = reward_amount - (packaging_cost + labor_cost + logistics_cost);
  return {
    packaging_cost: round2(packaging_cost),
    labor_minutes: round2(labor_minutes),
    labor_cost: round2(labor_cost),
    logistics_cost: round2(logistics_cost),
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
