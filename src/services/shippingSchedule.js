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
// Время cutoff трактуется в МСК (Europe/Moscow, фикс UTC+3 — РФ без перехода
// на летнее время). На Vercel сервер в UTC, поэтому без сдвига cutoff 10:00
// превращался бы в МСК 13:00. Возвращаем Date — абсолютный момент (UTC),
// который при форматировании в МСК даёт нужный час.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const toMsk = (d) => new Date(d.getTime() + MSK_OFFSET_MS);
const fromMsk = (d) => new Date(d.getTime() - MSK_OFFSET_MS);

export function nextShippingDate(scheduleDays, cutoffTime, now = new Date()) {
  const allowed = parseDays(scheduleDays);
  if (allowed.size === 0) return null;
  const { hours, minutes } = parseCutoff(cutoffTime);

  // Работаем в «псевдо-UTC, который на самом деле МСК».
  const mskNow = toMsk(now);
  const mskResult = new Date(mskNow);
  mskResult.setUTCHours(hours, minutes, 0, 0);

  // Сегодня в МСК — отгрузочный и ещё не прошёл дедлайн.
  if (allowed.has(mskNow.getUTCDay()) && mskNow.getTime() < mskResult.getTime()) {
    return fromMsk(mskResult);
  }

  // Ищем ближайший следующий день (по МСК-календарю).
  for (let i = 1; i <= 7; i += 1) {
    const candidate = new Date(mskNow);
    candidate.setUTCDate(mskNow.getUTCDate() + i);
    candidate.setUTCHours(hours, minutes, 0, 0);
    if (allowed.has(candidate.getUTCDay())) return fromMsk(candidate);
  }
  return null;
}

export function weekdayLabel(code) {
  const labels = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
  return labels[String(code).toLowerCase()] || code;
}

export { NUM_TO_WEEKDAY };
