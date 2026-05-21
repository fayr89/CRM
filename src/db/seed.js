// Скрипт для заполнения базы демо-данными.
// Использование: npm run seed
import { hashPassword } from '../auth.js';
import { db, ensureInitialized, closeDb } from '../db.js';

const SAMPLE_USERS = [
  { email: 'manager@example.com', password: 'manager123', name: 'Мария Менеджер', role: 'manager' },
  { email: 'alice@example.com', password: 'sales123', name: 'Алиса Продажник', role: 'sales' },
  { email: 'bob@example.com', password: 'sales123', name: 'Борис Продажник', role: 'sales' },
];

const SAMPLE_COMPANIES = [
  { name: 'ООО "Ромашка"', industry: 'Производство', website: 'https://romashka.example', size: 'large', annual_revenue: 50000000 },
  { name: 'ГлобалКорп', industry: 'Энергетика', website: 'https://globalcorp.example', size: 'enterprise', annual_revenue: 200000000 },
  { name: 'СофтДев', industry: 'IT', website: 'https://softdev.example', size: 'medium', annual_revenue: 15000000 },
  { name: 'ЭкоФуд', industry: 'Продукты питания', website: 'https://ecofood.example', size: 'small', annual_revenue: 2000000 },
];

const SAMPLE_LEADS = [
  { first_name: 'Иван', last_name: 'Петров', email: 'ivan@biztech.example', company_name: 'БизТех', source: 'website', status: 'new', estimated_value: 25000 },
  { first_name: 'Анна', last_name: 'Смирнова', email: 'anna@futurecorp.example', company_name: 'ФьючерКорп', source: 'referral', status: 'contacted', estimated_value: 75000 },
  { first_name: 'Михаил', last_name: 'Кузнецов', email: 'mihail@megainc.example', company_name: 'Мега Инк', source: 'cold_call', status: 'qualified', estimated_value: 120000 },
];

async function seed() {
  await ensureInitialized();

  const existing = await db.get('SELECT COUNT(*)::int AS n FROM companies');
  if (existing.n > 0) {
    // eslint-disable-next-line no-console
    console.log('[seed] В базе уже есть компании, пропускаю.');
    return;
  }

  for (const u of SAMPLE_USERS) {
    await db.run(
      `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`,
      u.email,
      hashPassword(u.password),
      u.name,
      u.role,
    );
  }

  const owner = await db.get(`SELECT id FROM users WHERE role = 'sales' LIMIT 1`);
  const ownerId = owner?.id || 1;

  const companyIds = [];
  for (const c of SAMPLE_COMPANIES) {
    const r = await db.run(
      `INSERT INTO companies (name, industry, website, size, annual_revenue, owner_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      c.name,
      c.industry,
      c.website,
      c.size,
      c.annual_revenue,
      ownerId,
    );
    companyIds.push(r.lastInsertRowid);
  }

  const contacts = [
    { first_name: 'Сергей', last_name: 'Волков', email: 'sergey@romashka.example', position: 'CTO', company_id: companyIds[0] },
    { first_name: 'Елена', last_name: 'Соколова', email: 'elena@globalcorp.example', position: 'CEO', company_id: companyIds[1] },
    { first_name: 'Дмитрий', last_name: 'Орлов', email: 'dmitry@softdev.example', position: 'Инженер', company_id: companyIds[2] },
  ];
  const contactIds = [];
  for (const c of contacts) {
    const r = await db.run(
      `INSERT INTO contacts (first_name, last_name, email, position, company_id, owner_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      c.first_name,
      c.last_name,
      c.email,
      c.position,
      c.company_id,
      ownerId,
    );
    contactIds.push(r.lastInsertRowid);
  }

  for (const l of SAMPLE_LEADS) {
    await db.run(
      `INSERT INTO leads (first_name, last_name, email, company_name, source, status, estimated_value, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      l.first_name,
      l.last_name,
      l.email,
      l.company_name,
      l.source,
      l.status,
      l.estimated_value,
      ownerId,
    );
  }

  const deals = [
    { title: 'Ромашка: расширение Q2', amount: 50000, stage: 'qualified', probability: 25, contact_id: contactIds[0], company_id: companyIds[0] },
    { title: 'ГлобалКорп: годовой контракт', amount: 250000, stage: 'proposal', probability: 50, contact_id: contactIds[1], company_id: companyIds[1] },
    { title: 'СофтДев: внедрение', amount: 80000, stage: 'negotiation', probability: 75, contact_id: contactIds[2], company_id: companyIds[2] },
    { title: 'Старая сделка (закрыта)', amount: 30000, stage: 'won', probability: 100, company_id: companyIds[3] },
  ];
  for (const d of deals) {
    const closedAt = d.stage === 'won' || d.stage === 'lost' ? new Date().toISOString() : null;
    await db.run(
      `INSERT INTO deals (title, amount, stage, probability, contact_id, company_id, owner_id, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      d.title,
      d.amount,
      d.stage,
      d.probability,
      d.contact_id ?? null,
      d.company_id,
      ownerId,
      closedAt,
    );
  }

  const dueTomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const dueIn3Days = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  await db.run(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'call',
    'Перезвонить Ромашке',
    dueTomorrow,
    'deal',
    1,
    ownerId,
  );
  await db.run(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'meeting',
    'Демо для ГлобалКорп',
    dueIn3Days,
    'deal',
    2,
    ownerId,
  );

  // eslint-disable-next-line no-console
  console.log('[seed] Демо-данные созданы.');
}

try {
  await seed();
} finally {
  await closeDb();
}
