import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, asyncHandler } from '../errors.js';
import { parseDays, parseCutoff, nextShippingDate } from '../services/shippingSchedule.js';

const router = Router();

router.use(authenticate);

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Все аутентифицированные могут видеть график (менеджерам тоже надо знать).
router.get(
  '/schedule',
  asyncHandler(async (_req, res) => {
    const row = await db.get('SELECT * FROM shipping_schedule WHERE id = 1');
    const nextDate = row
      ? nextShippingDate(row.days, row.cutoff_time)
      : null;
    res.json({
      ...row,
      days_list: row?.days ? row.days.split(',') : [],
      next_shipping_date: nextDate ? nextDate.toISOString() : null,
    });
  }),
);

const updateSchema = z.object({
  days: z
    .array(z.enum(VALID_DAYS))
    .min(1, 'Должен быть хотя бы один день отгрузки'),
  cutoff_time: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, 'Время в формате HH:MM')
    .optional(),
  notes: z.string().optional().nullable(),
});

// Менять график могут только склад и админ.
router.put(
  '/schedule',
  requireRole('admin', 'warehouse'),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const daysStr = Array.from(new Set(data.days)).join(',');
    // Валидация cutoff
    if (data.cutoff_time) {
      const { hours, minutes } = parseCutoff(data.cutoff_time);
      if (hours > 23 || minutes > 59) {
        throw BadRequest('Некорректное время отсечки');
      }
    }
    await db.run(
      `INSERT INTO shipping_schedule (id, days, cutoff_time, notes, updated_by, updated_at)
       VALUES (1, ?, COALESCE(?, '14:00'), ?, ?, NOW())
       ON CONFLICT (id) DO UPDATE SET
         days = EXCLUDED.days,
         cutoff_time = COALESCE(EXCLUDED.cutoff_time, shipping_schedule.cutoff_time),
         notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      daysStr,
      data.cutoff_time ?? null,
      data.notes ?? null,
      req.user.id,
    );
    const row = await db.get('SELECT * FROM shipping_schedule WHERE id = 1');
    const nextDate = nextShippingDate(row.days, row.cutoff_time);
    res.json({
      ...row,
      days_list: row.days.split(','),
      next_shipping_date: nextDate ? nextDate.toISOString() : null,
    });
  }),
);

export default router;
