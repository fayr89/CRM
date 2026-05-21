import { db } from '../db.js';

const WEEKDAY_TO_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const NUM_TO_WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export async function getSchedule() {
  return await db.get('SELECT * FROM shipping_schedule WHERE id = 1');
}

// Парсит "mon,wed,fri" → Set([1,3,5])
export function parseDays(days) {
  return new Set(
    String(days || '')
      .split(',')
      .map((d) => WEEKDAY_TO_NUM[d.trim().toLowerCase()])
      .filter((n) => n !== undefined),
  );
}

// Парсит "14:00" → {hours: 14, minutes: 0}
export function parseCutoff(cutoff) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cutoff || '14:00').trim());
  if (!m) return { hours: 14, minutes: 0 };
  return { hours: Math.min(23, Math.max(0, +m[1])), minutes: Math.min(59, Math.max(0, +m[2])) };
}

// Вычисляет ближайшую дату отгрузки от now с учётом графика.
// Возвращает Date с часом = cutoff (т.е. дата+время дедлайна на тот день).
// Если сегодня — отгрузочный день и время до cutoff: возвращает сегодня.
// Иначе: следующий день из расписания.
export function nextShippingDate(scheduleDays, cutoffTime, now = new Date()) {
  const allowed = parseDays(scheduleDays);
  if (allowed.size === 0) return null;
  const { hours, minutes } = parseCutoff(cutoffTime);

  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);

  // Сегодня — отгрузочный и ещё не прошёл дедлайн
  if (allowed.has(now.getDay()) && now.getTime() < result.getTime()) {
    return result;
  }

  // Ищем ближайший следующий день
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    candidate.setHours(hours, minutes, 0, 0);
    if (allowed.has(candidate.getDay())) return candidate;
  }
  return null;
}

export function weekdayLabel(code) {
  const labels = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
  return labels[String(code).toLowerCase()] || code;
}

export { NUM_TO_WEEKDAY };
