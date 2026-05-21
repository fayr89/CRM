// Seed script: populates the database with sample data for development/demo.
// Usage: npm run seed
import { hashPassword } from '../auth.js';
import { getDb } from '../db.js';

const db = getDb();

const SAMPLE_USERS = [
  { email: 'manager@example.com', password: 'manager123', name: 'Mary Manager', role: 'manager' },
  { email: 'alice@example.com', password: 'sales123', name: 'Alice Sales', role: 'sales' },
  { email: 'bob@example.com', password: 'sales123', name: 'Bob Sales', role: 'sales' },
];

const SAMPLE_COMPANIES = [
  { name: 'Acme Corp', industry: 'Manufacturing', website: 'https://acme.com', size: 'large', annual_revenue: 50000000 },
  { name: 'Globex', industry: 'Energy', website: 'https://globex.io', size: 'enterprise', annual_revenue: 200000000 },
  { name: 'Initech', industry: 'Software', website: 'https://initech.dev', size: 'medium', annual_revenue: 15000000 },
  { name: 'Soylent', industry: 'Food', website: 'https://soylent.test', size: 'small', annual_revenue: 2000000 },
];

const SAMPLE_LEADS = [
  { first_name: 'John', last_name: 'Doe', email: 'john@biztech.com', company_name: 'BizTech', source: 'website', status: 'new', estimated_value: 25000 },
  { first_name: 'Jane', last_name: 'Smith', email: 'jane@futurecorp.com', company_name: 'FutureCorp', source: 'referral', status: 'contacted', estimated_value: 75000 },
  { first_name: 'Mike', last_name: 'Brown', email: 'mike@megainc.com', company_name: 'Mega Inc', source: 'cold_call', status: 'qualified', estimated_value: 120000 },
];

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log('[seed] Database already has companies, skipping.');
    return;
  }

  for (const u of SAMPLE_USERS) {
    db.prepare(
      `INSERT OR IGNORE INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)`,
    ).run(u.email, hashPassword(u.password), u.name, u.role);
  }

  const ownerId = db.prepare(`SELECT id FROM users WHERE role = 'sales' LIMIT 1`).get()?.id || 1;

  const companyIds = [];
  for (const c of SAMPLE_COMPANIES) {
    const r = db
      .prepare(
        `INSERT INTO companies (name, industry, website, size, annual_revenue, owner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.name, c.industry, c.website, c.size, c.annual_revenue, ownerId);
    companyIds.push(r.lastInsertRowid);
  }

  const contacts = [
    { first_name: 'Wile', last_name: 'Coyote', email: 'wile@acme.com', position: 'CTO', company_id: companyIds[0] },
    { first_name: 'Hank', last_name: 'Scorpio', email: 'hank@globex.io', position: 'CEO', company_id: companyIds[1] },
    { first_name: 'Peter', last_name: 'Gibbons', email: 'peter@initech.dev', position: 'Engineer', company_id: companyIds[2] },
  ];
  const contactIds = [];
  for (const c of contacts) {
    const r = db
      .prepare(
        `INSERT INTO contacts (first_name, last_name, email, position, company_id, owner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.first_name, c.last_name, c.email, c.position, c.company_id, ownerId);
    contactIds.push(r.lastInsertRowid);
  }

  for (const l of SAMPLE_LEADS) {
    db.prepare(
      `INSERT INTO leads (first_name, last_name, email, company_name, source, status, estimated_value, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(l.first_name, l.last_name, l.email, l.company_name, l.source, l.status, l.estimated_value, ownerId);
  }

  const deals = [
    { title: 'Acme Q2 expansion', amount: 50000, stage: 'qualified', probability: 25, contact_id: contactIds[0], company_id: companyIds[0] },
    { title: 'Globex annual contract', amount: 250000, stage: 'proposal', probability: 50, contact_id: contactIds[1], company_id: companyIds[1] },
    { title: 'Initech rollout', amount: 80000, stage: 'negotiation', probability: 75, contact_id: contactIds[2], company_id: companyIds[2] },
    { title: 'Old deal (closed)', amount: 30000, stage: 'won', probability: 100, company_id: companyIds[3] },
  ];
  for (const d of deals) {
    db.prepare(
      `INSERT INTO deals (title, amount, stage, probability, contact_id, company_id, owner_id, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${d.stage === 'won' || d.stage === 'lost' ? "datetime('now')" : 'NULL'})`,
    ).run(d.title, d.amount, d.stage, d.probability, d.contact_id ?? null, d.company_id, ownerId);
  }

  db.prepare(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES ('call', 'Follow up with Acme', datetime('now', '+1 day'), 'deal', 1, ?)`,
  ).run(ownerId);
  db.prepare(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES ('meeting', 'Demo for Globex', datetime('now', '+3 days'), 'deal', 2, ?)`,
  ).run(ownerId);

  // eslint-disable-next-line no-console
  console.log('[seed] Sample data created.');
}

seed();
