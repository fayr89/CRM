// Аудит-лог действий: ключевые операции (reserve, ship, cancel и т.п.) пишут
// сюда строку с пользователем, типом сущности и опциональными деталями.
// Не блокирует основной запрос: при ошибке только пишет в console.error.
import { db } from '../db.js';

export async function logAction(req, { action, entity_type, entity_id, details } = {}) {
  if (!action) return;
  try {
    const user = req?.user;
    const ip = (req?.headers?.['x-forwarded-for'] || req?.ip || '').toString().split(',')[0].trim() || null;
    await db.run(
      `INSERT INTO audit_log
       (user_id, user_name, user_role, action, entity_type, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
      user?.id || null,
      user?.name || null,
      user?.role || null,
      action,
      entity_type || null,
      entity_id || null,
      details ? JSON.stringify(details) : null,
      ip,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audit]', e.message);
  }
}
