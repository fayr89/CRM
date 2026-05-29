// Касса менеджера: баланс (сумма подтверждённых платежей) и сводка по статусам.
import { Router } from 'express';
import { canAccessUser } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { Forbidden, asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

// Сумма с учётом типа (расход вычитается) минус комиссия — «чистый» оборот.
// Комиссия у расходов (возвратов) тоже идёт с обратным знаком — иначе при возврате
// дохода 10 000 ₽ с комиссией 500 ₽ баланс показывал бы −10 500 (а должен −9500,
// потому что комиссия 500 ₽ возвращается вместе с самой суммой).
const NET = `COALESCE(SUM(CASE WHEN kind = 'expense' THEN -amount ELSE amount END), 0)::float`;
const COMM = `COALESCE(SUM(CASE WHEN kind = 'expense' THEN -commission ELSE commission END), 0)::float`;

// scopeSql/params — фильтр (manager_id = ? для менеджера, пусто для admin/finance — вся касса).
async function cashboxSummary(scopeSql, params) {
  const w = scopeSql ? `${scopeSql} AND` : '';
  const confirmed = await db.get(
    `SELECT ${NET} AS sum, ${COMM} AS commission, COUNT(*)::int AS count
     FROM payments p WHERE ${w} status = 'confirmed'`,
    ...params,
  );
  const pending = await db.get(
    `SELECT ${NET} AS sum, COUNT(*)::int AS count
     FROM payments p WHERE ${w} status = 'pending'`,
    ...params,
  );
  const rejected = await db.get(
    `SELECT COUNT(*)::int AS count FROM payments p WHERE ${w} status = 'rejected'`,
    ...params,
  );
  const recent = await db.all(
    `SELECT p.*, o.reference_number AS order_reference, u.name AS manager_name
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN users u ON u.id = p.manager_id
     ${scopeSql ? `WHERE ${scopeSql}` : ''} ORDER BY p.created_at DESC LIMIT 20`,
    ...params,
  );
  return {
    balance: confirmed.sum - confirmed.commission,
    confirmed: { count: confirmed.count, sum: confirmed.sum, commission: confirmed.commission },
    pending: { count: pending.count, sum: pending.sum },
    rejected: { count: rejected.count },
    recent,
  };
}

// Касса текущего пользователя (admin/finance — вся касса либо по фильтру manager_id,
// остальные — только своя).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (['admin', 'finance'].includes(req.user.role)) {
      // Опциональный фильтр по конкретному менеджеру.
      const mid = req.query.manager_id ? Number(req.query.manager_id) : null;
      if (mid) {
        res.json(await cashboxSummary('p.manager_id = ?', [mid]));
      } else {
        res.json(await cashboxSummary('', []));
      }
    } else {
      res.json(await cashboxSummary('p.manager_id = ?', [req.user.id]));
    }
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
    res.json(await cashboxSummary('p.manager_id = ?', [id]));
  }),
);

export default router;
