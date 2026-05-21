import { Router } from 'express';
import { ownerScopeClause } from '../access.js';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const scope = await ownerScopeClause(req.user);
    // Дополнительный фильтр по конкретному owner_id если передан
    const extraOwner = req.query.owner_id ? Number(req.query.owner_id) : null;

    function buildWhere(scopeSql, scopeParams) {
      const where = [];
      const params = [];
      if (scopeSql) {
        where.push(scopeSql);
        params.push(...scopeParams);
      }
      if (extraOwner) {
        where.push('owner_id = ?');
        params.push(extraOwner);
      }
      return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
    }

    const w = buildWhere(scope.sql, scope.params);

    const [companies, contacts, leads, deals] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM companies ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM contacts ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM leads ${w.sql}`, ...w.params),
      db.get(`SELECT COUNT(*)::int AS n FROM deals ${w.sql}`, ...w.params),
    ]);

    const totals = {
      companies: companies.n,
      contacts: contacts.n,
      leads: leads.n,
      deals: deals.n,
    };

    const leadsByStatus = await db.all(
      `SELECT status, COUNT(*)::int AS count FROM leads ${w.sql} GROUP BY status`,
      ...w.params,
    );

    const dealStats = await db.all(
      `SELECT stage, COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS amount,
              COALESCE(SUM(amount * probability / 100.0), 0)::float AS weighted_amount
       FROM deals ${w.sql} GROUP BY stage`,
      ...w.params,
    );

    const openDeals = dealStats.filter((s) =>
      ['new', 'qualified', 'proposal', 'negotiation'].includes(s.stage),
    );
    const wonDeals = dealStats.find((s) => s.stage === 'won') || { count: 0, amount: 0 };
    const lostDeals = dealStats.find((s) => s.stage === 'lost') || { count: 0, amount: 0 };

    const pipelineValue = openDeals.reduce((acc, s) => acc + Number(s.amount), 0);
    const weightedPipelineValue = openDeals.reduce(
      (acc, s) => acc + Number(s.weighted_amount), 0,
    );

    const closedTotal = wonDeals.count + lostDeals.count;
    const winRate = closedTotal > 0 ? wonDeals.count / closedTotal : 0;

    const upcomingWhereParts = [
      'completed_at IS NULL AND (due_date IS NULL OR due_date >= NOW())',
    ];
    const overdueWhereParts = ['completed_at IS NULL AND due_date < NOW()'];
    const aParams = [];
    if (scope.sql) {
      upcomingWhereParts.push(scope.sql);
      overdueWhereParts.push(scope.sql);
      aParams.push(...scope.params);
    }
    if (extraOwner) {
      upcomingWhereParts.push('owner_id = ?');
      overdueWhereParts.push('owner_id = ?');
      aParams.push(extraOwner);
    }
    const upcoming = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities WHERE ${upcomingWhereParts.join(' AND ')}`,
      ...aParams,
    );
    const overdue = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities WHERE ${overdueWhereParts.join(' AND ')}`,
      ...aParams,
    );

    res.json({
      totals,
      leads: { by_status: leadsByStatus },
      deals: {
        by_stage: dealStats,
        pipeline_value: pipelineValue,
        weighted_pipeline_value: weightedPipelineValue,
        won: { count: wonDeals.count, amount: Number(wonDeals.amount) },
        lost: { count: lostDeals.count, amount: Number(lostDeals.amount) },
        win_rate: Number(winRate.toFixed(4)),
      },
      activities: {
        upcoming: upcoming.n,
        overdue: overdue.n,
      },
    });
  }),
);

router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const scope = await ownerScopeClause(req.user);
    const w = scope.sql ? `WHERE ${scope.sql}` : '';
    const params = scope.sql ? scope.params : [];
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const [recentLeads, recentContacts, recentDeals, recentActivities] = await Promise.all([
      db.all(`SELECT * FROM leads ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM contacts ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM deals ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
      db.all(`SELECT * FROM activities ${w} ORDER BY created_at DESC LIMIT ?`, ...params, limit),
    ]);
    res.json({
      leads: recentLeads,
      contacts: recentContacts,
      deals: recentDeals,
      activities: recentActivities,
    });
  }),
);

export default router;
