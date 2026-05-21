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

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  app.use(errorHandler);

  return app;
}
