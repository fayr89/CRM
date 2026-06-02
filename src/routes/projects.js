// Проекты: справочник для группировки лидов/сделок/контактов/компаний.
// Создаёт/редактирует только админ. Список для выпадашек — всем авторизованным.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, Forbidden, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();
router.use(authenticate);

// Палитра по умолчанию для UI — пользователь может вписать любой hex.
const DEFAULT_COLOR = '#6366f1';
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет должен быть в формате #RRGGBB');

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: hexColor.optional().default(DEFAULT_COLOR),
  description: z.string().max(500).optional().nullable(),
  active: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
});
const updateSchema = createSchema.partial();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // active=true — только активные (для выпадашек). По умолчанию — все.
    const onlyActive = req.query.active === 'true';
    const where = onlyActive ? 'WHERE active = TRUE' : '';
    const rows = await db.all(
      `SELECT id, name, color, description, active, sort_order, created_at, updated_at
       FROM projects ${where}
       ORDER BY sort_order ASC, name ASC`,
    );
    res.json({ data: rows });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!row) throw NotFound('Проект не найден');
    res.json({ data: row });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw Forbidden('Только админ может создавать проекты');
    const data = createSchema.parse(req.body);
    const existing = await db.get('SELECT id FROM projects WHERE LOWER(name) = LOWER(?)', data.name);
    if (existing) throw BadRequest('Проект с таким именем уже существует');
    const r = await db.run(
      `INSERT INTO projects (name, color, description, active, sort_order)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      data.name, data.color, data.description ?? null, data.active, data.sort_order,
    );
    const created = await db.get('SELECT * FROM projects WHERE id = ?', r.lastInsertRowid);
    await logAction(req, { action: 'project.created', entity_type: 'project', entity_id: created.id, details: { name: created.name } });
    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw Forbidden('Только админ может менять проекты');
    const data = updateSchema.parse(req.body);
    const existing = await db.get('SELECT id, name FROM projects WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Проект не найден');
    if (data.name && data.name !== existing.name) {
      const dup = await db.get(
        'SELECT id FROM projects WHERE LOWER(name) = LOWER(?) AND id != ?',
        data.name, req.params.id,
      );
      if (dup) throw BadRequest('Проект с таким именем уже существует');
    }
    const updates = [];
    const params = [];
    for (const [key, val] of Object.entries(data)) {
      updates.push(`${key} = ?`);
      params.push(val);
    }
    if (!updates.length) return res.json({ data: existing });
    updates.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, ...params);
    const updated = await db.get('SELECT * FROM projects WHERE id = ?', req.params.id);
    await logAction(req, { action: 'project.updated', entity_type: 'project', entity_id: updated.id, details: { fields: Object.keys(data) } });
    res.json({ data: updated });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') throw Forbidden('Только админ может удалять проекты');
    const existing = await db.get('SELECT id, name FROM projects WHERE id = ?', req.params.id);
    if (!existing) throw NotFound('Проект не найден');
    // ON DELETE SET NULL — лиды/сделки/контакты/компании теряют project_id, но не удаляются.
    await db.run('DELETE FROM projects WHERE id = ?', req.params.id);
    await logAction(req, { action: 'project.deleted', entity_type: 'project', entity_id: existing.id, details: { name: existing.name } });
    res.json({ ok: true });
  }),
);

export default router;
