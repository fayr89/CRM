import { Router } from 'express';
import { authenticate } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

router.use(authenticate);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const ownerId = req.query.owner_id ? Number(req.query.owner_id) : null;
    const ownerWhere = ownerId ? 'WHERE owner_id = ?' : '';
    const ownerParams = ownerId ? [ownerId] : [];

    const [companies, contacts, leads, deals] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM companies ${ownerWhere}`, ...ownerParams),
      db.get(`SELECT COUNT(*)::int AS n FROM contacts ${ownerWhere}`, ...ownerParams),
      db.get(`SELECT COUNT(*)::int AS n FROM leads ${ownerWhere}`, ...ownerParams),
      db.get(`SELECT COUNT(*)::int AS n FROM deals ${ownerWhere}`, ...ownerParams),
    ]);

    const totals = {
      companies: companies.n,
      contacts: contacts.n,
      leads: leads.n,
      deals: deals.n,
    };

    const leadsByStatus = await db.all(
      `SELECT status, COUNT(*)::int AS count FROM leads ${ownerWhere} GROUP BY status`,
      ...ownerParams,
    );

    const dealStats = await db.all(
      `SELECT stage, COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS amount,
              COALESCE(SUM(amount * probability / 100.0), 0)::float AS weighted_amount
       FROM deals ${ownerWhere} GROUP BY stage`,
      ...ownerParams,
    );

    const openDeals = dealStats.filter((s) =>
      ['new', 'qualified', 'proposal', 'negotiation'].includes(s.stage),
    );
    const wonDeals = dealStats.find((s) => s.stage === 'won') || { count: 0, amount: 0 };
    const lostDeals = dealStats.find((s) => s.stage === 'lost') || { count: 0, amount: 0 };

    const pipelineValue = openDeals.reduce((acc, s) => acc + Number(s.amount), 0);
    const weightedPipelineValue = openDeals.reduce(
      (acc, s) => acc + Number(s.weighted_amount),
      0,
    );

    const closedTotal = wonDeals.count + lostDeals.count;
    const winRate = closedTotal > 0 ? wonDeals.count / closedTotal : 0;

    const upcomingWhere = ownerId
      ? 'WHERE completed_at IS NULL AND (due_date IS NULL OR due_date >= NOW()) AND owner_id = ?'
      : 'WHERE completed_at IS NULL AND (due_date IS NULL OR due_date >= NOW())';
    const overdueWhere = ownerId
      ? 'WHERE completed_at IS NULL AND due_date < NOW() AND owner_id = ?'
      : 'WHERE completed_at IS NULL AND due_date < NOW()';

    const upcoming = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities ${upcomingWhere}`,
      ...ownerParams,
    );
    const overdue = await db.get(
      `SELECT COUNT(*)::int AS n FROM activities ${overdueWhere}`,
      ...ownerParams,
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
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const [recentLeads, recentContacts, recentDeals, recentActivities] = await Promise.all([
      db.all('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?', limit),
      db.all('SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?', limit),
      db.all('SELECT * FROM deals ORDER BY created_at DESC LIMIT ?', limit),
      db.all('SELECT * FROM activities ORDER BY created_at DESC LIMIT ?', limit),
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
