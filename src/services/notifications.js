import { db } from '../db.js';

export async function notify(userId, type, title, body, link) {
  if (!userId) return;
  await db.run(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES (?, ?, ?, ?, ?)`,
    userId,
    type,
    title,
    body ?? null,
    link ?? null,
  );
}

export async function notifyMany(userIds, type, title, body, link) {
  for (const id of userIds) await notify(id, type, title, body, link);
}

export async function notifyAdminsAndManagers(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role IN ('admin','manager') AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}

export async function notifyAdmins(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role = 'admin' AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}

export async function notifyWarehouse(type, title, body, link) {
  const rows = await db.all(
    `SELECT id FROM users WHERE role = 'warehouse' AND active = TRUE`,
  );
  await notifyMany(rows.map((r) => r.id), type, title, body, link);
}
