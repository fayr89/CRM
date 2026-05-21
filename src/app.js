import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorHandler } from './errors.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export function createApp({ serveStatic = true } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  if (serveStatic) app.use(express.static(PUBLIC_DIR));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  app.use(errorHandler);

  return app;
}
