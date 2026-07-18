// Фиче-флаги / тестовые зоны. Первый потребитель — модуль «Поставки → Доставки»
// (ТЗ 18.07.2026): большой новый функционал, который на время тестирования НЕ
// должен мешать текущему рабочему процессу менеджеров.
//
// Модель изоляции:
//   - Конфиг в app_settings['features.supply_delivery'] = { enabled, test_user_ids }.
//   - По умолчанию enabled=false → зону не видит НИКТО из обычных менеджеров.
//   - Админ ВСЕГДА видит пункт меню (чтобы настроить/тестировать и включить доступ).
//   - Пользователь из test_user_ids видит зону ТОЛЬКО когда enabled=true.
//   - «Работать» в зоне (data-эндпоинты) можно только когда enabled=true И ты
//     админ или в списке тест-пользователей. Пока флаг выключен — API инертен.
//
// Так новый модуль живёт в проде, но полностью изолирован от боевого потока,
// пока владелец явно не включит его для конкретных тест-аккаунтов.
import { db } from '../db.js';

const KEY = 'features.supply_delivery';
const DEFAULT = { enabled: false, test_user_ids: [] };

async function ensureSettingsTable() {
  await db.run(
    `CREATE TABLE IF NOT EXISTS app_settings (
       key TEXT PRIMARY KEY, value JSONB NOT NULL,
       updated_by INTEGER, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  );
}

export async function getSupplyDeliveryConfig() {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', KEY).catch(() => null);
  const v = row?.value;
  if (!v || typeof v !== 'object') return { ...DEFAULT };
  return {
    enabled: !!v.enabled,
    test_user_ids: Array.isArray(v.test_user_ids)
      ? v.test_user_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n))
      : [],
  };
}

export async function setSupplyDeliveryConfig(cfg, userId) {
  await ensureSettingsTable();
  const clean = {
    enabled: !!cfg.enabled,
    test_user_ids: Array.isArray(cfg.test_user_ids)
      ? [...new Set(cfg.test_user_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n)))]
      : [],
  };
  await db.run(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES (?, ?::jsonb, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    KEY, JSON.stringify(clean), userId,
  );
  return clean;
}

// Видит ли пользователь пункт меню тест-зоны (админ — всегда; тест-юзер — при enabled).
export function canSeeSupplyDelivery(user, cfg) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!cfg.enabled && cfg.test_user_ids.includes(user.id);
}

// Может ли пользователь реально работать в зоне (data-эндпоинты). Пока флаг
// выключен — НИКТО, даже админ (чтобы случайно не залить тестовые данные в бой).
export function canOperateSupplyDelivery(user, cfg) {
  if (!user || !cfg.enabled) return false;
  return user.role === 'admin' || cfg.test_user_ids.includes(user.id);
}
