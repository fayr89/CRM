import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Use an isolated database for tests.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.sqlite');
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'testpass123';

const { createApp } = await import('../src/app.js');
const { closeDb, getDb } = await import('../src/db.js');

const app = createApp();
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

let adminToken;

test('health endpoint', async () => {
  const r = await req('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
});

test('login as default admin', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'admin@test.local', password: 'testpass123' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.user.role, 'admin');
  adminToken = r.data.token;
});

test('reject login with wrong password', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { email: 'admin@test.local', password: 'wrong' },
  });
  assert.equal(r.status, 401);
});

test('reject request without token', async () => {
  const r = await req('GET', '/api/contacts');
  assert.equal(r.status, 401);
});

test('create and list a company', async () => {
  const created = await req('POST', '/api/companies', {
    token: adminToken,
    body: { name: 'Test Co', industry: 'Tech', size: 'medium' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.name, 'Test Co');

  const list = await req('GET', '/api/companies', { token: adminToken });
  assert.equal(list.status, 200);
  assert.ok(list.data.data.find((c) => c.name === 'Test Co'));
});

test('create contact attached to a company', async () => {
  const company = await req('POST', '/api/companies', {
    token: adminToken,
    body: { name: 'Contact Co' },
  });
  const contact = await req('POST', '/api/contacts', {
    token: adminToken,
    body: {
      first_name: 'John',
      last_name: 'Tester',
      email: 'john@test.com',
      company_id: company.data.id,
    },
  });
  assert.equal(contact.status, 201);
  assert.equal(contact.data.company_id, company.data.id);
});

test('lead conversion creates contact + deal + company', async () => {
  const lead = await req('POST', '/api/leads', {
    token: adminToken,
    body: {
      first_name: 'Lead',
      last_name: 'Person',
      email: 'lead@test.com',
      company_name: 'LeadCo',
      source: 'website',
      estimated_value: 5000,
    },
  });
  assert.equal(lead.status, 201);

  const convert = await req('POST', `/api/leads/${lead.data.id}/convert`, {
    token: adminToken,
    body: {},
  });
  assert.equal(convert.status, 200);
  assert.equal(convert.data.lead.status, 'converted');
  assert.ok(convert.data.contact.id);
  assert.ok(convert.data.deal.id);
  assert.equal(convert.data.deal.amount, 5000);
});

test('deal pipeline returns stage breakdown', async () => {
  await req('POST', '/api/deals', {
    token: adminToken,
    body: { title: 'Pipeline test', amount: 10000, stage: 'qualified' },
  });
  const r = await req('GET', '/api/deals/pipeline', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.stages));
  assert.equal(r.data.stages.length, 6);
  assert.ok(r.data.pipeline_value >= 10000);
});

test('win a deal', async () => {
  const created = await req('POST', '/api/deals', {
    token: adminToken,
    body: { title: 'To win', amount: 1000 },
  });
  const win = await req('POST', `/api/deals/${created.data.id}/win`, { token: adminToken });
  assert.equal(win.status, 200);
  assert.equal(win.data.stage, 'won');
  assert.equal(win.data.probability, 100);
  assert.ok(win.data.closed_at);
});

test('notes can be attached and listed', async () => {
  const company = await req('POST', '/api/companies', {
    token: adminToken,
    body: { name: 'Note Co' },
  });
  const note = await req('POST', '/api/notes', {
    token: adminToken,
    body: { content: 'Important note', related_to_type: 'company', related_to_id: company.data.id },
  });
  assert.equal(note.status, 201);
  const list = await req(
    'GET',
    `/api/notes?related_to_type=company&related_to_id=${company.data.id}`,
    { token: adminToken },
  );
  assert.equal(list.status, 200);
  assert.equal(list.data.data.length, 1);
});

test('dashboard stats endpoint', async () => {
  const r = await req('GET', '/api/dashboard/stats', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.data.totals);
  assert.ok(r.data.deals);
  assert.ok(r.data.activities);
});

test('validation rejects bad input', async () => {
  const r = await req('POST', '/api/contacts', {
    token: adminToken,
    body: { last_name: 'Missing first name' },
  });
  assert.equal(r.status, 400);
});

test.after(() => {
  server.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
