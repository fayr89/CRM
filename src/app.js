import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler } from './errors.js';
import { tickMsQueue } from './services/ms-jobs.js';
import './services/ms-handlers.js'; // регистрирует обработчики МС-очереди при импорте
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import companiesRoutes from './routes/companies.js';
import contactsRoutes from './routes/contacts.js';
import leadsRoutes from './routes/leads.js';
import dealsRoutes from './routes/deals.js';
import activitiesRoutes from './routes/activities.js';
import notesRoutes from './routes/notes.js';
import dashboardRoutes from './routes/dashboard.js';
import invitationsRoutes from './routes/invitations.js';
import ordersRoutes from './routes/orders.js';
import paymentsRoutes from './routes/payments.js';
import cashboxRoutes from './routes/cashbox.js';
import externalRoutes from './routes/external.js';
import apiTokensRoutes from './routes/apiTokens.js';
import webhooksRoutes from './routes/webhooks.js';
import notificationsRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import productsRoutes from './routes/products.js';
import pricingRoutes from './routes/pricing.js';
import warehouseRoutes from './routes/warehouseSettings.js';
import analyticsRoutes from './routes/analytics.js';
import adminRoutes from './routes/admin.js';
import feedbackRoutes from './routes/feedback.js';
import cronRoutes from './routes/cron.js';
import maxRoutes from './routes/max.js';
import aiProposalsRoutes from './routes/aiProposals.js';
import noticeBannersRoutes from './routes/noticeBanners.js';
import notificationPrefsRoutes from './routes/notificationPrefs.js';
import projectsRoutes from './routes/projects.js';
import materialsRoutes from './routes/materials.js';
import processingPlansRoutes from './routes/processingPlans.js';
import productionOrdersRoutes from './routes/productionOrders.js';
import contractsRoutes from './routes/contracts.js';
import productionPLRoutes from './routes/productionPL.js';
import productionReceiptRoutes from './routes/productionReceipt.js';
import productionSettingsRoutes from './routes/productionSettings.js';
import supplyDeliveryRoutes from './routes/supplyDelivery.js';
import callingRoutes from './routes/calling.js';
import stockWatchesRoutes from './routes/stockWatches.js';
import productionRequestsRoutes from './routes/productionRequests.js';
import bootstrapRoutes from './routes/bootstrap.js';
import pushRoutes from './routes/push.js';
import diagDailyRoutes from './routes/diagDaily.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function createApp({ serveStatic = true } = {}) {
  const app = express();

  // Отключаем ETag для API: иначе повторные GET отдают 304, а фронт трактует
  // не-2xx как ошибку (данные теряются — например, не грузились фильтры складов).
  app.set('etag', false);
  // Trust proxy: на проде стоит nginx-прокси в РФ → Vercel → лямбда. Без trust proxy
  // req.ip будет адресом ближнего прокси (одинаковый у всех клиентов), и rate-limit
  // на логине заблокирует ВСЕХ при первой ошибке одного. С trust proxy req.ip берётся
  // из X-Forwarded-For — настоящий IP клиента.
  app.set('trust proxy', true);

  // CORS: разрешить same-origin, localhost и vercel.app домены
  const extraOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

  app.use(cors({
    origin: (origin, callback) => {
      // Разрешаем: запросы без origin (same-origin, curl), localhost, *.vercel.app, и из ALLOWED_ORIGINS
      if (!origin
        || /^https?:\/\/localhost(:\d+)?$/.test(origin)
        || /\.vercel\.app$/.test(origin)
        || extraOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // По умолчанию разрешаем (можно ужесточить позже)
      }
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '20mb' }));
  // API не кэшируем — иначе повторные GET отдают 304 (фронт трактует как ошибку).
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Бедный воркер МС-очереди: дёргается при каждом /api-запросе, но не чаще раз в 30 сек.
    tickMsQueue();
    next();
  });
  if (serveStatic) app.use(express.static(PUBLIC_DIR));

  app.get('/health', (_req, res) => {
    // Диагностика latency: показываем регион Vercel-функции и хост БД.
    // Если они в разных регионах — каждый DB-запрос идёт межконтинентально.
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
    const dbHost = dbUrl.match(/@([^:/]+)/)?.[1] || null;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      vercel_region: process.env.VERCEL_REGION || null,
      db_host: dbHost,
    });
  });

  app.get('/api', (_req, res) => {
    res.json({
      name: 'CRM API',
      version: '1.0.0',
      endpoints: {
        auth: '/api/auth (login, register, me)',
        users: '/api/users — пользователи',
        companies: '/api/companies — компании',
        contacts: '/api/contacts — контакты',
        leads: '/api/leads — лиды',
        deals: '/api/deals (+ /pipeline) — сделки',
        activities: '/api/activities — задачи',
        notes: '/api/notes — заметки',
        dashboard: '/api/dashboard/stats — дашборд',
        invitations: '/api/invitations — приглашения',
        orders: '/api/orders — заказы (модуль Avito / прямые продажи)',
        payments: '/api/payments — платежи',
        cashbox: '/api/cashbox — касса менеджера',
        products: '/api/products — каталог товаров (с прайсами и импортом из МойСклад)',
        external: '/api/external/{leads,orders} — приём заявок с сайтов и мессенджеров по токену',
        api_tokens: '/api/api-tokens — управление токенами для внешних интеграций (admin)',
        webhooks: '/api/webhooks — исходящие вебхуки на изменения данных (admin)',
        notifications: '/api/notifications — уведомления пользователя',
        search: '/api/search?q=… — глобальный поиск по объектам',
        warehouse: '/api/warehouse/schedule — график отгрузок (для склада и менеджеров)',
        analytics: '/api/analytics/{revenue,managers,marketplaces,products,funnel,summary} — аналитика (admin/manager)',
        orders_export: '/api/orders/export.csv?status=reserved — выгрузка заказов в CSV/Excel',
        ready_to_ship: '/api/orders/ready-to-ship — список заказов готовых к отгрузке + ближайшая дата',
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/contacts', contactsRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/deals', dealsRoutes);
  app.use('/api/activities', activitiesRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/invitations', invitationsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/cashbox', cashboxRoutes);
  app.use('/api/external', externalRoutes);
  app.use('/api/api-tokens', apiTokensRoutes);
  app.use('/api/webhooks', webhooksRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/pricing', pricingRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/cron', cronRoutes);
  app.use('/api/max', maxRoutes);
  app.use('/api/ai-proposals', aiProposalsRoutes);
  app.use('/api/notice-banners', noticeBannersRoutes);
  app.use('/api/notification-prefs', notificationPrefsRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/materials', materialsRoutes);
  app.use('/api/processing-plans', processingPlansRoutes);
  app.use('/api/production-orders', productionOrdersRoutes);
  app.use('/api/contracts', contractsRoutes);
  app.use('/api/production', productionPLRoutes);
  app.use('/api/production/receipt', productionReceiptRoutes);
  app.use('/api/production-settings', productionSettingsRoutes);
  // ТЕСТОВАЯ ЗОНА «Поставки → Доставки» (ТЗ 18.07.2026). Всё под фиче-флагом,
  // по умолчанию выключено — не влияет на боевой поток. См. routes/supplyDelivery.js.
  app.use('/api/supply-delivery', supplyDeliveryRoutes);
  app.use('/api/calling', callingRoutes);
  app.use('/api/stock-watches', stockWatchesRoutes);
  app.use('/api/production-requests', productionRequestsRoutes);
  app.use('/api/bootstrap', bootstrapRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/diag/daily-v1302', diagDailyRoutes);
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  app.use(errorHandler);

  return app;
}
