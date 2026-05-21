import { Router } from 'express';
import { authenticate } from '../auth.js';
import { getDb } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ownerFilter = req.query.owner_id ? Number(req.query.owner_id) : null;
    const ownerWhere = ownerFilter ? `WHERE owner_id = ${ownerFilter}` : '';

    const totals = {
      companies: db.prepare(`SELECT COUNT(*) AS n FROM companies ${ownerWhere}`).get().n,
      contacts: db.prepare(`SELECT COUNT(*) AS n FROM contacts ${ownerWhere}`).get().n,
      leads: db.prepare(`SELECT COUNT(*) AS n FROM leads ${ownerWhere}`).get().n,
      deals: db.prepare(`SELECT COUNT(*) AS n FROM deals ${ownerWhere}`).get().n,
    };

    const leadsByStatus = db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM leads ${ownerWhere} GROUP BY status`,
      )
      .all();

    const dealStats = db
      .prepare(
        `SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount,
                COALESCE(SUM(amount * probability / 100.0), 0) AS weighted_amount
         FROM deals ${ownerWhere} GROUP BY stage`,
      )
      .all();

    const openDeals = dealStats.filter((s) =>
      ['new', 'qualified', 'proposal', 'negotiation'].includes(s.stage),
    );
    const wonDeals = dealStats.find((s) => s.stage === 'won') || { count: 0, amount: 0 };
    const lostDeals = dealStats.find((s) => s.stage === 'lost') || { count: 0, amount: 0 };

    const pipelineValue = openDeals.reduce((acc, s) => acc + s.amount, 0);
    const weightedPipelineValue = openDeals.reduce((acc, s) => acc + s.weighted_amount, 0);

    const closedTotal = wonDeals.count + lostDeals.count;
    const winRate = closedTotal > 0 ? wonDeals.count / closedTotal : 0;

    const upcomingActivities = db
      .prepare(
        `SELECT COUNT(*) AS n FROM activities
         WHERE completed_at IS NULL AND (due_date IS NULL OR due_date >= datetime('now'))
         ${ownerFilter ? `AND owner_id = ${ownerFilter}` : ''}`,
      )
      .get().n;

    const overdueActivities = db
      .prepare(
        `SELECT COUNT(*) AS n FROM activities
         WHERE completed_at IS NULL AND due_date < datetime('now')
         ${ownerFilter ? `AND owner_id = ${ownerFilter}` : ''}`,
      )
      .get().n;

    res.json({
      totals,
      leads: { by_status: leadsByStatus },
      deals: {
        by_stage: dealStats,
        pipeline_value: pipelineValue,
        weighted_pipeline_value: weightedPipelineValue,
        won: { count: wonDeals.count, amount: wonDeals.amount },
        lost: { count: lostDeals.count, amount: lostDeals.amount },
        win_rate: Number(winRate.toFixed(4)),
      },
      activities: {
        upcoming: upcomingActivities,
        overdue: overdueActivities,
      },
    });
  }),
);

router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const recent = {
      leads: db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?').all(limit),
      contacts: db.prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?').all(limit),
      deals: db.prepare('SELECT * FROM deals ORDER BY created_at DESC LIMIT ?').all(limit),
      activities: db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT ?').all(limit),
    };
    res.json(recent);
  }),
);

export default router;
