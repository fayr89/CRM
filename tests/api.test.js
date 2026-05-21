import { strict as assert } from 'node:assert';
import test from 'node:test';

// Integration tests require a Postgres database.
// Set TEST_DATABASE_URL (or DATABASE_URL) to a fresh DB.
const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  test('integration tests skipped (no TEST_DATABASE_URL)', () => {});
} else {
  process.env.DATABASE_URL = dbUrl;
  process.env.JWT_SECRET = 'test-secret';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.local';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';

  const { createApp } = await import('../src/app.js');
  const { closeDb, db, ensureInitialized } = await import('../src/db.js');

  // Clean DB between test runs
  await ensureInitialized();
  await db.run('DELETE FROM payments');
  await db.run('DELETE FROM order_items');
  await db.run('DELETE FROM orders');
  await db.run('DELETE FROM notes');
  await db.run('DELETE FROM activities');
  await db.run('DELETE FROM deals');
  await db.run('DELETE FROM leads');
  await db.run('DELETE FROM contacts');
  await db.run('DELETE FROM companies');
  await db.run('DELETE FROM invitations');
  await db.run("DELETE FROM users WHERE email != ?", process.env.ADMIN_EMAIL);
  for (const t of [
    'notes', 'activities', 'deals', 'leads', 'contacts', 'companies',
    'invitations', 'orders', 'order_items', 'payments',
  ]) {
    await db.run(`ALTER SEQUENCE ${t}_id_seq RESTART WITH 1`);
  }

  const app = createApp({ serveStatic: false });
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
      body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.token);
    assert.equal(r.data.user.role, 'admin');
    adminToken = r.data.token;
  });

  test('reject login with wrong password', async () => {
    const r = await req('POST', '/api/auth/login', {
      body: { email: process.env.ADMIN_EMAIL, password: 'wrong' },
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
      body: {
        content: 'Important note',
        related_to_type: 'company',
        related_to_id: company.data.id,
      },
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

  // --- Иерархия и приглашения ---

  let managerToken, managerId, salesToken, salesId, otherSalesToken, otherSalesId;

  test('admin creates a manager', async () => {
    const r = await req('POST', '/api/users', {
      token: adminToken,
      body: {
        email: 'mgr@test.local',
        password: 'mgrpass1',
        name: 'Менеджер',
        role: 'manager',
      },
    });
    assert.equal(r.status, 201);
    managerId = r.data.id;
    const login = await req('POST', '/api/auth/login', {
      body: { email: 'mgr@test.local', password: 'mgrpass1' },
    });
    managerToken = login.data.token;
  });

  test('manager creates a sales user under themselves', async () => {
    const r = await req('POST', '/api/users', {
      token: managerToken,
      body: {
        email: 'sales1@test.local',
        password: 'salespass',
        name: 'Продажник 1',
        // role/manager_id игнорируются для manager — всегда sales под менеджером
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.role, 'sales');
    assert.equal(r.data.manager_id, managerId);
    salesId = r.data.id;
    const login = await req('POST', '/api/auth/login', {
      body: { email: 'sales1@test.local', password: 'salespass' },
    });
    salesToken = login.data.token;
  });

  test('manager cannot create a manager-role user', async () => {
    const r = await req('POST', '/api/users', {
      token: managerToken,
      body: { email: 'try@test.local', password: 'pass123', name: 'X', role: 'manager' },
    });
    assert.equal(r.status, 403);
  });

  test('admin creates another sales user NOT under our manager', async () => {
    const r = await req('POST', '/api/users', {
      token: adminToken,
      body: {
        email: 'sales2@test.local',
        password: 'salespass',
        name: 'Продажник 2',
        role: 'sales',
      },
    });
    assert.equal(r.status, 201);
    otherSalesId = r.data.id;
    const login = await req('POST', '/api/auth/login', {
      body: { email: 'sales2@test.local', password: 'salespass' },
    });
    otherSalesToken = login.data.token;
  });

  test('users list scoping: sales sees only self', async () => {
    const r = await req('GET', '/api/users', { token: salesToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.data.length, 1);
    assert.equal(r.data.data[0].id, salesId);
  });

  test('users list scoping: manager sees self + subordinates', async () => {
    const r = await req('GET', '/api/users', { token: managerToken });
    assert.equal(r.status, 200);
    const ids = r.data.data.map((u) => u.id).sort();
    assert.deepEqual(ids, [managerId, salesId].sort());
  });

  test('sales1 creates a company; sales2 cannot see it', async () => {
    const c1 = await req('POST', '/api/companies', {
      token: salesToken,
      body: { name: 'Sales1 Co' },
    });
    assert.equal(c1.status, 201);
    assert.equal(c1.data.owner_id, salesId);

    const listFromOther = await req('GET', '/api/companies', { token: otherSalesToken });
    assert.equal(listFromOther.status, 200);
    assert.equal(listFromOther.data.data.find((c) => c.id === c1.data.id), undefined);

    const get = await req('GET', `/api/companies/${c1.data.id}`, { token: otherSalesToken });
    assert.equal(get.status, 403);
  });

  test('manager sees subordinate (sales1) companies', async () => {
    const list = await req('GET', '/api/companies', { token: managerToken });
    assert.equal(list.status, 200);
    assert.ok(list.data.data.find((c) => c.owner_id === salesId));
  });

  test('manager creates invitation; user accepts it', async () => {
    const create = await req('POST', '/api/invitations', {
      token: managerToken,
      body: { email: 'invitee@test.local', name: 'Приглашённый', role: 'sales' },
    });
    assert.equal(create.status, 201);
    assert.ok(create.data.token);
    assert.equal(create.data.role, 'sales');
    assert.equal(create.data.manager_id, managerId);

    const accept = await req('POST', '/api/auth/accept-invite', {
      body: {
        token: create.data.token,
        name: 'Принял Приглашение',
        password: 'newpass1',
      },
    });
    assert.equal(accept.status, 201);
    assert.ok(accept.data.token);
    assert.equal(accept.data.user.role, 'sales');

    // Не должны принять второй раз
    const reaccept = await req('POST', '/api/auth/accept-invite', {
      body: { token: create.data.token, name: 'X', password: 'newpass2' },
    });
    assert.equal(reaccept.status, 400);
  });

  test('sales cannot create invitations', async () => {
    const r = await req('POST', '/api/invitations', {
      token: salesToken,
      body: { email: 'x@test.local', role: 'sales' },
    });
    assert.equal(r.status, 403);
  });

  test('manager cannot invite as manager role', async () => {
    const r = await req('POST', '/api/invitations', {
      token: managerToken,
      body: { email: 'y@test.local', role: 'manager' },
    });
    assert.equal(r.status, 403);
  });

  test('only admin can delete users', async () => {
    const r = await req('DELETE', `/api/users/${salesId}`, { token: managerToken });
    assert.equal(r.status, 403);
  });

  test('dashboard is scoped to accessible owners', async () => {
    // У sales2 ничего нет, поэтому дашборд должен показывать нули
    const r = await req('GET', '/api/dashboard/stats', { token: otherSalesToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.totals.companies, 0);
  });

  // --- Модуль Avito: заказы, склад, платежи, касса ---

  let warehouseToken, warehouseId, orderId;

  test('admin creates a warehouse user', async () => {
    const r = await req('POST', '/api/users', {
      token: adminToken,
      body: {
        email: 'wh@test.local',
        password: 'whpass1',
        name: 'Склад',
        role: 'warehouse',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.role, 'warehouse');
    warehouseId = r.data.id;
    const login = await req('POST', '/api/auth/login', {
      body: { email: 'wh@test.local', password: 'whpass1' },
    });
    warehouseToken = login.data.token;
  });

  test('manager creates an order with items', async () => {
    const r = await req('POST', '/api/orders', {
      token: managerToken,
      body: {
        reference_number: 'WB-123456',
        marketplace: 'Wildberries',
        client_classification: 'B2C',
        client_name: 'И.И. Иванов',
        items: [
          { sku: 'A-1', name: 'Товар А', quantity: 2, unit_price: 1000 },
          { sku: 'B-2', name: 'Товар Б', quantity: 1, unit_price: 500 },
        ],
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.total_amount, 2500);
    assert.equal(r.data.status, 'new');
    assert.equal(r.data.items.length, 2);
    orderId = r.data.id;
  });

  test('order requires at least one item', async () => {
    const r = await req('POST', '/api/orders', {
      token: managerToken,
      body: { marketplace: 'Ozon', items: [] },
    });
    assert.equal(r.status, 400);
  });

  test('warehouse sees all orders; sales1 sees nothing from manager', async () => {
    const fromWh = await req('GET', '/api/orders', { token: warehouseToken });
    assert.equal(fromWh.status, 200);
    assert.ok(fromWh.data.data.find((o) => o.id === orderId));

    // Алиса — sales под Марией. Её manager_id = managerId. Заказ создал manager
    // (managerId), поэтому Алиса (как sales) не видит — она видит только свои.
    const fromSales = await req('GET', '/api/orders', { token: salesToken });
    assert.equal(fromSales.status, 200);
    assert.equal(fromSales.data.data.find((o) => o.id === orderId), undefined);
  });

  test('warehouse reserves and ships the order', async () => {
    const reserve = await req('POST', `/api/orders/${orderId}/reserve`, { token: warehouseToken });
    assert.equal(reserve.status, 200);
    assert.equal(reserve.data.status, 'reserved');
    assert.ok(reserve.data.reserved_at);

    const ship = await req('POST', `/api/orders/${orderId}/ship`, { token: warehouseToken });
    assert.equal(ship.status, 200);
    assert.equal(ship.data.status, 'shipped');
    assert.ok(ship.data.shipped_at);
  });

  test('cannot reserve an already-reserved order', async () => {
    const r = await req('POST', `/api/orders/${orderId}/reserve`, { token: warehouseToken });
    assert.equal(r.status, 400);
  });

  test('manager cannot reserve', async () => {
    const order2 = await req('POST', '/api/orders', {
      token: managerToken,
      body: { items: [{ name: 'X', quantity: 1, unit_price: 100 }] },
    });
    const r = await req('POST', `/api/orders/${order2.data.id}/reserve`, { token: managerToken });
    assert.equal(r.status, 403);
  });

  test('manager adds a payment for the shipped order', async () => {
    const r = await req('POST', '/api/payments', {
      token: managerToken,
      body: {
        amount: 2500,
        currency: 'RUB',
        method: 'bank_transfer',
        reference: 'TRX-789',
        order_id: orderId,
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.amount, 2500);
  });

  test('cashbox shows pending payment, zero balance until confirmed', async () => {
    const r = await req('GET', '/api/cashbox', { token: managerToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.balance, 0);
    assert.equal(r.data.pending.count, 1);
    assert.equal(r.data.pending.sum, 2500);
  });

  test('warehouse cannot see payments', async () => {
    const r = await req('GET', '/api/payments', { token: warehouseToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.data.length, 0);
  });

  test('admin confirms the payment, balance updates', async () => {
    const payments = await req('GET', '/api/payments?status=pending', { token: adminToken });
    const paymentId = payments.data.data[0].id;
    const confirm = await req('POST', `/api/payments/${paymentId}/confirm`, { token: adminToken });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.data.status, 'confirmed');

    const cashbox = await req('GET', '/api/cashbox', { token: managerToken });
    assert.equal(cashbox.data.balance, 2500);
    assert.equal(cashbox.data.confirmed.count, 1);
    assert.equal(cashbox.data.pending.count, 0);
  });

  test('admin can reject a payment with reason', async () => {
    const created = await req('POST', '/api/payments', {
      token: managerToken,
      body: { amount: 100, method: 'cash' },
    });
    const reject = await req('POST', `/api/payments/${created.data.id}/reject`, {
      token: adminToken,
      body: { reason: 'Не подтверждена оплата' },
    });
    assert.equal(reject.status, 200);
    assert.equal(reject.data.status, 'rejected');
    assert.equal(reject.data.rejection_reason, 'Не подтверждена оплата');
  });

  test('manager completes the shipped order', async () => {
    const r = await req('POST', `/api/orders/${orderId}/complete`, { token: managerToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'completed');
  });

  test.after(async () => {
    server.close();
    await closeDb();
  });
}
