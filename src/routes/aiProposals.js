// AI-предложения: inbox для админа от AI-ассистента.
// AI создаёт proposal (POST), админ через UI принимает/отклоняет/отправляет на доработку.
// Следующий обход AI читает решения и действует.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth.js';
import { db } from '../db.js';
import { BadRequest, NotFound, asyncHandler } from '../errors.js';
import { logAction } from '../services/audit.js';

const router = Router();

router.use(authenticate);

// Список предложений с фильтрами. Только админ.
router.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('p.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.feedback_id) {
      where.push('p.feedback_id = ?');
      params.push(Number(req.query.feedback_id));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT p.*, u.name AS admin_decision_by_name,
              f.subject AS feedback_subject, f.user_id AS feedback_user_id,
              fu.name AS feedback_author_name
       FROM ai_proposals p
       LEFT JOIN users u ON u.id = p.admin_decision_by
       LEFT JOIN feedback f ON f.id = p.feedback_id
       LEFT JOIN users fu ON fu.id = f.user_id
       ${whereSql}
       ORDER BY (CASE p.status WHEN 'pending' THEN 0 WHEN 'revision' THEN 1
                WHEN 'approved' THEN 2 WHEN 'done' THEN 3 ELSE 4 END),
                p.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    const total = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals p ${whereSql}`, ...params);
    res.json({ data: rows, total: total?.n || 0 });
  }),
);

// Счётчик ждущих решения админа (для бейджа в навигации).
router.get(
  '/pending-count',
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const { n } = await db.get(`SELECT COUNT(*)::int AS n FROM ai_proposals WHERE status IN ('pending','revision')`);
    res.json({ count: n || 0 });
  }),
);

// Создать предложение. Только admin (AI работает под admin-токеном).
const createSchema = z.object({
  feedback_id: z.number().int().positive().optional().nullable(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(5000),
  category: z.string().max(60).optional().nullable(),
  risk: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  source: z.string().max(60).optional().nullable(),
  proposed_changes: z.array(z.object({
    file: z.string().optional(),
    action: z.string().optional(),
    reason: z.string().optional(),
  })).optional().nullable(),
});
router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body || {});
    const r = await db.run(
      `INSERT INTO ai_proposals
       (feedback_id, title, summary, category, risk, source, proposed_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      data.feedback_id ?? null,
      data.title,
      data.summary,
      data.category ?? null,
      data.risk || 'medium',
      data.source ?? null,
      data.proposed_changes ? JSON.stringify(data.proposed_changes) : null,
    );
    const created = await db.get('SELECT * FROM ai_proposals WHERE id = ?', r.lastInsertRowid);
    res.status(201).json(created);
  }),
);

// Решение админа: approve | reject | revision | done. С опциональной заметкой.
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revision', 'done']),
  notes: z.string().max(5000).optional().nullable(),
});
router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = decisionSchema.parse(req.body || {});
    const cur = await db.get('SELECT * FROM ai_proposals WHERE id = ?', req.params.id);
    if (!cur) throw NotFound('Предложение не найдено');
    if (data.decision === 'revision' && !data.notes?.trim()) {
      throw BadRequest('Для «На доработку» нужна заметка с инструкцией для AI');
    }
    await db.run(
      `UPDATE ai_proposals SET status = ?, admin_notes = ?,
       admin_decision_by = ?, admin_decision_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      data.decision,
      data.notes ?? null,
      req.user.id,
      cur.id,
    );
    await logAction(req, {
      action: `ai_proposal.${data.decision}`,
      entity_type: 'ai_proposal',
      entity_id: cur.id,
      details: { title: cur.title, has_notes: Boolean(data.notes) },
    });
    res.json(await db.get('SELECT * FROM ai_proposals WHERE id = ?', cur.id));
  }),
);

// Тред сообщений предложения: чтобы админ и AI могли несколько раз уточнить
// детали (одной admin_notes мало). GET — список. POST — добавить заметку.
router.get(
  '/:id/messages',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw BadRequest('id required');
    const rows = await db.all(
      `SELECT id, user_id, user_name, role, text, created_at
       FROM ai_proposal_messages
       WHERE proposal_id = ?
       ORDER BY created_at ASC, id ASC`,
      id,
    );
    res.json({ data: rows });
  }),
);

const messageSchema = z.object({
  text: z.string().min(1).max(5000),
  // user_name переопределяемое: AI постит от имени «AI ассистент», а не от
  // реального пользователя-владельца токена. См. правило в CLAUDE.md.
  user_name: z.string().max(120).optional().nullable(),
});
router.post(
  '/:id/messages',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw BadRequest('id required');
    const data = messageSchema.parse(req.body || {});
    const cur = await db.get('SELECT id FROM ai_proposals WHERE id = ?', id);
    if (!cur) throw NotFound('Предложение не найдено');
    const r = await db.run(
      `INSERT INTO ai_proposal_messages (proposal_id, user_id, user_name, role, text)
       VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`,
      id,
      req.user.id,
      data.user_name || req.user.name || null,
      req.user.role,
      data.text,
    );
    await logAction(req, {
      action: 'ai_proposal.message',
      entity_type: 'ai_proposal',
      entity_id: id,
      details: { length: data.text.length },
    });
    res.status(201).json({ id: r.lastInsertRowid, created_at: r.created_at });
  }),
);

// Удалить предложение (например, дубль).
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await db.run('DELETE FROM ai_proposals WHERE id = ?', req.params.id);
    if (result.changes === 0) throw NotFound('Предложение не найдено');
    await logAction(req, {
      action: 'ai_proposal.deleted',
      entity_type: 'ai_proposal',
      entity_id: Number(req.params.id),
    });
    res.status(204).send();
  }),
);

export default router;
