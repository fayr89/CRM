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
  await db.run('DELETE FROM webhook_deliveries');
  await db.run('DELETE FROM webhooks');
  await db.run('DELETE FROM api_tokens');
  await db.run('DELETE FROM notifications');
  await db.run('DELETE FROM payments');
  await db.run('DELETE FROM order_items');
  await db.run('DELETE FROM orders');
  await db.run('DELETE FROM product_prices');
  await db.run('DELETE FROM products');
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
    'api_tokens', 'webhooks', 'webhook_deliveries', 'notifications',
    'products', 'product_prices',
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

  // --- Интеграции: API-токены, внешние эндпойнты, вебхуки, уведомления ---

  let apiTokenRaw;

  test('admin creates an API token for external website', async () => {
    const r = await req('POST', '/api/api-tokens', {
      token: adminToken,
      body: { name: 'Лендинг example.com', scopes: 'leads:create,orders:create' },
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.token.startsWith('crm_'));
    apiTokenRaw = r.data.token;
  });

  test('external lead creation requires X-API-Token', async () => {
    const r = await fetch(`${base}/api/external/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ first_name: 'Аноним' }),
    });
    assert.equal(r.status, 401);
  });

  test('external lead arrives via valid API token, notifies admins', async () => {
    const r = await fetch(`${base}/api/external/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': apiTokenRaw },
      body: JSON.stringify({
        first_name: 'Пётр',
        last_name: 'Петров',
        phone: '+79991112233',
        source: 'website',
        description: 'Хочу узнать про услуги',
      }),
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    assert.equal(data.lead.first_name, 'Пётр');
    assert.equal(data.lead.source, 'website');

    // Уведомление должно прийти администратору
    const notif = await req('GET', '/api/notifications?unread=true', { token: adminToken });
    assert.equal(notif.status, 200);
    assert.ok(notif.data.unread >= 1);
    assert.ok(notif.data.data.some((n) => n.type === 'lead.created'));
  });

  test('external order requires items[] and creates with default manager', async () => {
    const empty = await fetch(`${base}/api/external/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': apiTokenRaw },
      body: JSON.stringify({ marketplace: 'Wildberries', items: [] }),
    });
    assert.equal(empty.status, 400);

    const r = await fetch(`${base}/api/external/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': apiTokenRaw },
      body: JSON.stringify({
        marketplace: 'Wildberries',
        reference_number: 'WB-EXT-1',
        client_name: 'И. Иванов',
        items: [{ sku: 'A-1', name: 'Носки', quantity: 3, unit_price: 200 }],
      }),
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    assert.equal(data.order.total_amount, 600);
    assert.equal(data.order.status, 'new');
  });

  test('revoked token stops working', async () => {
    const list = await req('GET', '/api/api-tokens', { token: adminToken });
    const tokenId = list.data.data[0].id;
    const rev = await req('POST', `/api/api-tokens/${tokenId}/revoke`, { token: adminToken });
    assert.equal(rev.status, 200);
    const after = await fetch(`${base}/api/external/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': apiTokenRaw },
      body: JSON.stringify({ first_name: 'Должен быть отказ' }),
    });
    assert.equal(after.status, 401);
  });

  test('admin creates a webhook, sees it in list', async () => {
    const r = await req('POST', '/api/webhooks', {
      token: adminToken,
      body: { name: 'Бухгалтерия', url: 'https://example.com/hook', events: 'order.created' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.name, 'Бухгалтерия');
    const list = await req('GET', '/api/webhooks', { token: adminToken });
    assert.equal(list.data.data.length, 1);
  });

  test('global search returns matches across resources', async () => {
    const r = await req('GET', '/api/search?q=Петров', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.leads.length >= 1);
  });

  test('notifications can be marked read', async () => {
    const list = await req('GET', '/api/notifications?unread=true', { token: adminToken });
    if (list.data.data.length > 0) {
      const id = list.data.data[0].id;
      const r = await req('POST', `/api/notifications/${id}/read`, { token: adminToken });
      assert.equal(r.status, 200);
    }
    const readAll = await req('POST', '/api/notifications/read-all', { token: adminToken });
    assert.equal(readAll.status, 200);
    const after = await req('GET', '/api/notifications?unread=true', { token: adminToken });
    assert.equal(after.data.unread, 0);
  });

  // --- Каталог товаров, прайсы, подстановка цен ---

  let productId;

  test('admin creates a product with cost price', async () => {
    const r = await req('POST', '/api/products', {
      token: adminToken,
      body: {
        sku: 'TST-1',
        name: 'Тестовый товар',
        image_url: 'https://example.com/img.jpg',
        cost_price: 500,
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.cost_price, 500);
    productId = r.data.id;
  });

  test('admin sets marketplace-specific prices', async () => {
    const wb = await req('PUT', `/api/products/${productId}/prices`, {
      token: adminToken,
      body: { marketplace: 'Wildberries', price: 1200 },
    });
    assert.equal(wb.status, 200);
    assert.equal(wb.data.price, 1200);

    const avito = await req('PUT', `/api/products/${productId}/prices`, {
      token: adminToken,
      body: { marketplace: 'Avito', price: 1500 },
    });
    assert.equal(avito.status, 200);

    const full = await req('GET', `/api/products/${productId}`, { token: adminToken });
    assert.equal(full.data.prices.length, 2);
  });

  test('updating a price upserts (no duplicates)', async () => {
    await req('PUT', `/api/products/${productId}/prices`, {
      token: adminToken,
      body: { marketplace: 'Wildberries', price: 1300 },
    });
    const full = await req('GET', `/api/products/${productId}`, { token: adminToken });
    const wb = full.data.prices.find((p) => p.marketplace === 'Wildberries');
    assert.equal(wb.price, 1300);
    assert.equal(full.data.prices.length, 2);
  });

  test('products for marketplace shows correct price', async () => {
    const wb = await req('GET', '/api/products/for-marketplace?marketplace=Wildberries', {
      token: adminToken,
    });
    const p = wb.data.data.find((x) => x.id === productId);
    assert.equal(p.marketplace_price, 1300);

    const avito = await req('GET', '/api/products/for-marketplace?marketplace=Avito', {
      token: adminToken,
    });
    const p2 = avito.data.data.find((x) => x.id === productId);
    assert.equal(p2.marketplace_price, 1500);

    const ozon = await req('GET', '/api/products/for-marketplace?marketplace=Ozon', {
      token: adminToken,
    });
    const p3 = ozon.data.data.find((x) => x.id === productId);
    assert.equal(p3.marketplace_price, null);
  });

  test('external order with known SKU auto-links product and uses marketplace price', async () => {
    // Восстанавливаем токен (старый отозван в предыдущем блоке)
    const tr = await req('POST', '/api/api-tokens', {
      token: adminToken,
      body: { name: 'Тест продукт', scopes: 'orders:create' },
    });
    const t = tr.data.token;
    const r = await fetch(`${base}/api/external/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': t },
      body: JSON.stringify({
        marketplace: 'Wildberries',
        client_name: 'Тестовый клиент',
        items: [{ sku: 'TST-1', name: 'Тестовый товар', quantity: 2, unit_price: 0 }],
      }),
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    // unit_price из прайса Wildberries (1300), всего 2 шт = 2600
    assert.equal(data.order.total_amount, 2600);
    assert.equal(data.order.items[0].product_id, productId);
    assert.equal(data.order.items[0].catalog_price, 1300);
    assert.equal(data.order.items[0].image_url, 'https://example.com/img.jpg');
  });

  test('product prices can be deleted', async () => {
    const del = await req('DELETE', `/api/products/${productId}/prices/Avito`, {
      token: adminToken,
    });
    assert.equal(del.status, 204);
    const full = await req('GET', `/api/products/${productId}`, { token: adminToken });
    assert.equal(full.data.prices.length, 1);
    assert.equal(full.data.prices[0].marketplace, 'Wildberries');
  });

  test('moysklad import requires token', async () => {
    delete process.env.MOYSKLAD_TOKEN;
    const r = await req('POST', '/api/products/import/moysklad', {
      token: adminToken,
      body: {},
    });
    assert.equal(r.status, 400);
  });

  // --- Расписание отгрузок ---

  test('warehouse schedule has a default and is readable', async () => {
    const r = await req('GET', '/api/warehouse/schedule', { token: managerToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.days);
    assert.ok(Array.isArray(r.data.days_list));
    assert.ok(r.data.next_shipping_date);
  });

  test('only warehouse/admin can update schedule', async () => {
    const denied = await req('PUT', '/api/warehouse/schedule', {
      token: managerToken,
      body: { days: ['mon', 'fri'], cutoff_time: '12:00' },
    });
    assert.equal(denied.status, 403);

    const ok = await req('PUT', '/api/warehouse/schedule', {
      token: adminToken,
      body: { days: ['mon', 'thu', 'fri'], cutoff_time: '15:30', notes: 'Только Ozon-фуры' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.days, 'mon,thu,fri');
    assert.equal(ok.data.cutoff_time, '15:30');
    assert.deepEqual(ok.data.days_list.sort(), ['fri', 'mon', 'thu']);
  });

  test('schedule rejects invalid weekdays and empty array', async () => {
    const empty = await req('PUT', '/api/warehouse/schedule', {
      token: adminToken,
      body: { days: [] },
    });
    assert.equal(empty.status, 400);

    const invalid = await req('PUT', '/api/warehouse/schedule', {
      token: adminToken,
      body: { days: ['foo', 'bar'] },
    });
    assert.equal(invalid.status, 400);
  });

  // --- Экспорт заказов в CSV ---

  test('orders CSV export returns text/csv with BOM and rows', async () => {
    const res = await fetch(`${base}/api/orders/export.csv`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/csv'));
    assert.ok(res.headers.get('content-disposition').includes('orders-'));
    const text = await res.text();
    assert.ok(text.startsWith('﻿'), 'CSV должен начинаться с UTF-8 BOM');
    assert.ok(text.includes('ID;'), 'Заголовок должен быть с ; разделителем');
  });

  test('orders CSV filters by status', async () => {
    const res = await fetch(`${base}/api/orders/export.csv?status=completed`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const text = await res.text();
    const lines = text.split('\r\n');
    assert.ok(lines.length >= 1, 'минимум заголовок должен быть');
  });

  // --- Заказы готовые к отгрузке ---

  test('ready-to-ship returns reserved orders + next date', async () => {
    const r = await req('GET', '/api/orders/ready-to-ship', { token: managerToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.schedule);
    assert.ok(r.data.next_shipping_date);
    assert.ok(Array.isArray(r.data.data));
  });

  // --- Аналитика ---

  test('analytics: revenue endpoint accessible by admin', async () => {
    const r = await req('GET', '/api/analytics/revenue?days=30', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.points);
    assert.ok(r.data.totals);
    assert.ok(typeof r.data.totals.revenue === 'number');
  });

  test('analytics is forbidden for sales role', async () => {
    const r = await req('GET', '/api/analytics/revenue', { token: salesToken });
    assert.equal(r.status, 403);
  });

  test('analytics: managers leaderboard returns ranked list', async () => {
    const r = await req('GET', '/api/analytics/managers?days=90', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.data));
    // Должны быть только manager/sales/admin
    for (const u of r.data.data) {
      assert.ok(['manager', 'sales', 'admin'].includes(u.role));
    }
  });

  test('analytics: marketplaces breakdown', async () => {
    const r = await req('GET', '/api/analytics/marketplaces?days=90', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.data));
  });

  test('analytics: top products', async () => {
    const r = await req('GET', '/api/analytics/products?days=90', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.data));
  });

  test('analytics: funnel breakdown', async () => {
    const r = await req('GET', '/api/analytics/funnel?days=90', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.leads));
    assert.ok(Array.isArray(r.data.deals));
  });

  test('analytics: summary endpoint for leadership', async () => {
    const r = await req('GET', '/api/analytics/summary?days=30', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.revenue);
    assert.ok(r.data.orders);
    assert.ok(r.data.deals);
    assert.ok(r.data.customers);
    assert.ok(typeof r.data.deals.win_rate === 'number');
  });

  test.after(async () => {
    server.close();
    await closeDb();
  });
}
