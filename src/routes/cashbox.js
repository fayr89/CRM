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
// projectId — опциональный фильтр по проекту (orders.project_id через JOIN).
async function cashboxSummary(scopeSql, params, projectId = null) {
  let scope = scopeSql;
  const p = [...params];
  if (projectId) {
    scope = scope ? `${scope} AND p.project_id = ?` : 'p.project_id = ?';
    p.push(Number(projectId));
  }
  const w = scope ? `${scope} AND` : '';
  const confirmed = await db.get(
    `SELECT ${NET} AS sum, ${COMM} AS commission, COUNT(*)::int AS count
     FROM payments p WHERE ${w} status = 'confirmed'`,
    ...p,
  );
  const pending = await db.get(
    `SELECT ${NET} AS sum, ${COMM} AS commission, COUNT(*)::int AS count
     FROM payments p WHERE ${w} status = 'pending'`,
    ...p,
  );
  const rejected = await db.get(
    `SELECT COUNT(*)::int AS count FROM payments p WHERE ${w} status = 'rejected'`,
    ...p,
  );
  const recent = await db.all(
    `SELECT p.*, o.reference_number AS order_reference, u.name AS manager_name
     FROM payments p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN users u ON u.id = p.manager_id
     ${scope ? `WHERE ${scope}` : ''} ORDER BY p.created_at DESC LIMIT 20`,
    ...p,
  );
  return {
    balance: confirmed.sum - confirmed.commission,
    confirmed: { count: confirmed.count, sum: confirmed.sum, commission: confirmed.commission },
    // Pending-баланс теперь тоже считает комиссию — менеджер сразу видит чистый
    // эффект: amount − commission для прихода, или для split-расхода уже учтено
    // в самих суммах (там commission = 0 на каждой строке).
    pending: { count: pending.count, sum: pending.sum - pending.commission, gross: pending.sum, commission: pending.commission },
    rejected: { count: rejected.count },
    recent,
  };
}

// Касса текущего пользователя (admin/finance — вся касса либо по фильтру manager_id,
// остальные — только своя).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    if (['admin', 'finance'].includes(req.user.role)) {
      // Опциональный фильтр по конкретному менеджеру.
      const mid = req.query.manager_id ? Number(req.query.manager_id) : null;
      if (mid) {
        res.json(await cashboxSummary('p.manager_id = ?', [mid], projectId));
      } else {
        res.json(await cashboxSummary('', [], projectId));
      }
    } else {
      res.json(await cashboxSummary('p.manager_id = ?', [req.user.id], projectId));
    }
  }),
);

// Касса другого пользователя — для админа или его менеджера.
// ВАЖНО: добавил regex ограничение ':userId' только цифрами — иначе
// любой следующий роут вида '/stats/...' мог бы случайно сматчиться
// как '/:userId' (если бы не было второго сегмента). Безопаснее явно.
router.get(
  '/:userId(\\d+)',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.userId);
    if (req.user.role !== 'admin' && !(await canAccessUser(req.user, id))) {
      throw Forbidden();
    }
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    res.json(await cashboxSummary('p.manager_id = ?', [id], projectId));
  }),
);

// Разбивка по методу оплаты за период (для диаграммы).
// Возвращает: [{method, count, gross, net, commission, pct_of_gross}, …]
// Учитываются только income confirmed (реальные зачисления), либо по статусу
// из query ?status=pending для прогноза. Расходы (expense) не влияют на
// «куда выведено» — это про приход.
router.get(
  '/stats/by-method',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    // Scope: админ/финансист видят всё (с фильтрами), остальные — только своё.
    const isFullAccess = ['admin', 'finance'].includes(req.user.role);
    if (isFullAccess) {
      if (req.query.manager_id) {
        where.push('p.manager_id = ?');
        params.push(Number(req.query.manager_id));
      }
    } else {
      where.push('p.manager_id = ?');
      params.push(req.user.id);
    }
    if (req.query.project_id) {
      // ВАЖНО: project_id хранится и в payments.project_id, и в orders.project_id —
      // используем прямое поле payments чтобы не JOIN'ить orders (быстрее).
      where.push('p.project_id = ?');
      params.push(Number(req.query.project_id));
    }
    const status = req.query.status || 'confirmed';
    where.push('p.status = ?');
    params.push(status);
    // income = приход, expense = расход. По умолчанию диаграмма по приходу —
    // «куда поступили деньги за период».
    const kind = req.query.kind || 'income';
    where.push('p.kind = ?');
    params.push(kind);
    if (req.query.date_from) {
      where.push('p.created_at >= ?::timestamptz');
      params.push(req.query.date_from);
    }
    if (req.query.date_to) {
      where.push('p.created_at < (?::date + INTERVAL \'1 day\')');
      params.push(req.query.date_to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await db.all(
      `SELECT COALESCE(p.method, '—') AS method,
              COUNT(*)::int AS count,
              COALESCE(SUM(p.amount), 0)::float AS gross,
              COALESCE(SUM(p.commission), 0)::float AS commission,
              (COALESCE(SUM(p.amount), 0) - COALESCE(SUM(p.commission), 0))::float AS net
       FROM payments p
       ${whereSql}
       GROUP BY COALESCE(p.method, '—')
       ORDER BY gross DESC`,
      ...params,
    );
    const totalGross = rows.reduce((s, r) => s + (r.gross || 0), 0);
    const totalNet = rows.reduce((s, r) => s + (r.net || 0), 0);
    const totalCommission = rows.reduce((s, r) => s + (r.commission || 0), 0);
    const totalCount = rows.reduce((s, r) => s + (r.count || 0), 0);
    const data = rows.map((r) => ({
      ...r,
      pct_of_gross: totalGross > 0 ? Math.round((r.gross / totalGross) * 1000) / 10 : 0,
    }));
    res.json({
      data,
      totals: { count: totalCount, gross: totalGross, net: totalNet, commission: totalCommission },
      filters: {
        status, kind,
        manager_id: req.query.manager_id ? Number(req.query.manager_id) : null,
        date_from: req.query.date_from || null,
        date_to: req.query.date_to || null,
      },
    });
  }),
);

export default router;
