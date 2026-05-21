// Хелперы для проверки прав доступа в рамках иерархии пользователей.
//
// Правила:
//   - admin    — видит и редактирует всех
//   - manager  — видит/редактирует себя и всё своё поддерево (manager_id = self,
//                либо менеджер этого пользователя — подчинённый, и т.д.)
//   - sales    — видит и редактирует только себя
//
// Записи в companies / contacts / leads / deals / activities имеют owner_id —
// видимость записи определяется тем, в чьём поддереве находится её владелец.
import { db } from './db.js';

// Возвращает массив id пользователей, к данным которых имеет доступ `user`.
// Для admin возвращает null — нет фильтрации.
export async function getAccessibleUserIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;
  if (user.role === 'sales') return [user.id];
  // manager: self + вся ветка вниз
  const rows = await db.all(
    `WITH RECURSIVE subordinates AS (
       SELECT id FROM users WHERE id = ?
       UNION ALL
       SELECT u.id FROM users u
       JOIN subordinates s ON u.manager_id = s.id
     )
     SELECT id FROM subordinates`,
    user.id,
  );
  return rows.map((r) => r.id);
}

// Возвращает SQL-фрагмент `owner_id = ANY(?)` и список параметров,
// либо пустые значения если фильтрация не нужна (admin).
export async function ownerScopeClause(user, col = 'owner_id') {
  const ids = await getAccessibleUserIds(user);
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: '1=0', params: [] };
  return { sql: `${col} = ANY(?)`, params: [ids] };
}

// Проверяет, может ли user видеть/менять запись с указанным owner_id.
// Запись без владельца — только admin.
export async function canAccessOwner(user, ownerId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ownerId == null) return false;
  const ids = await getAccessibleUserIds(user);
  return ids.includes(ownerId);
}

// Проверяет, может ли user видеть запись о другом пользователе.
export async function canAccessUser(user, targetUserId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.id === targetUserId) return true;
  const ids = await getAccessibleUserIds(user);
  return ids.includes(targetUserId);
}
