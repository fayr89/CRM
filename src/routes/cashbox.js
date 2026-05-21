// Касса менеджера: баланс (сумма подтверждённых платежей) и сводка по статусам.
import { Router } from 'express';
import { canAccessUser } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

async function cashboxSummary(userId) {
  const confirmed = await db.get(
    `SELECT COALESCE(SUM(amount), 0)::float AS sum, COUNT(*)::int AS count
     FROM payments WHERE manager_id = ? AND status = 'confirmed'`,
    userId,
  );
  const pending = await db.get(
    `SELECT COALESCE(SUM(amount), 0)::float AS sum, COUNT(*)::int AS count
     FROM payments WHERE manager_id = ? AND status = 'pending'`,
    userId,
  );
  const rejected = await db.get(
    `SELECT COUNT(*)::int AS count
     FROM payments WHERE manager_id = ? AND status = 'rejected'`,
    userId,
  );
  const recent = await db.all(
    `SELECT p.*, o.reference_number AS order_reference
     FROM payments p LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.manager_id = ? ORDER BY p.created_at DESC LIMIT 20`,
    userId,
  );
  return {
    user_id: userId,
    balance: confirmed.sum,
    confirmed: { count: confirmed.count, sum: confirmed.sum },
    pending: { count: pending.count, sum: pending.sum },
    rejected: { count: rejected.count },
    recent,
  };
}

// Касса текущего пользователя
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await cashboxSummary(req.user.id));
  }),
);

// Касса другого пользователя — для админа или его менеджера
router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.userId);
    if (req.user.role !== 'admin' && !(await canAccessUser(req.user, id))) {
      throw Forbidden();
    }
    res.json(await cashboxSummary(id));
  }),
);

export default router;
