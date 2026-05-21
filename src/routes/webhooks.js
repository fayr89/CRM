import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { NotFound, asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db.all(
      `SELECT w.*, u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries_count,
              (SELECT delivered_at FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY id DESC LIMIT 1) AS last_delivery_at,
              (SELECT status_code FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY id DESC LIMIT 1) AS last_status_code
       FROM webhooks w
       LEFT JOIN users u ON u.id = w.created_by
       ORDER BY w.id DESC`,
    );
    res.json({ data: rows });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.string().optional().default('*'),
  secret: z.string().optional().nullable(),
  active: z.boolean().optional().default(true),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const r = await db.run(
      `INSERT INTO webhooks (name, url, events, secret, active, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      data.name,
      data.url,
      data.events,
      data.secret ?? null,
      data.active,
      req.user.id,
    );
    res.status(201).json(await db.get('SELECT * FROM webhooks WHERE id = ?', r.lastInsertRowid));
  }),
);

const updateSchema = createSchema.partial();

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const updates = [];
    const params = [];
    for (const k of ['name', 'url', 'events', 'secret', 'active']) {
      if (data[k] !== undefined) {
        updates.push(`${k} = ?`);
        params.push(data[k]);
      }
    }
    if (!updates.length) {
      return res.json(await db.get('SELECT * FROM webhooks WHERE id = ?', req.params.id));
    }
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await db.run(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, ...params);
    if (r.changes === 0) throw NotFound('Webhook не найден');
    res.json(await db.get('SELECT * FROM webhooks WHERE id = ?', req.params.id));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const r = await db.run('DELETE FROM webhooks WHERE id = ?', req.params.id);
    if (r.changes === 0) throw NotFound('Webhook не найден');
    res.status(204).send();
  }),
);

router.get(
  '/:id/deliveries',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT id, event, status_code, error, delivered_at
       FROM webhook_deliveries WHERE webhook_id = ?
       ORDER BY id DESC LIMIT 50`,
      req.params.id,
    );
    res.json({ data: rows });
  }),
);

export default router;
