// Скрипт для заполнения базы демо-данными.
// Использование: npm run seed
import { hashPassword } from '../auth.js';
import { db, ensureInitialized, closeDb } from '../db.js';
import { generateToken, hashToken, tokenPrefix } from '../middleware/apiToken.js';

async function seed() {
  await ensureInitialized();

  const existing = await db.get('SELECT COUNT(*)::int AS n FROM companies');
  if (existing.n > 0) {
    // eslint-disable-next-line no-console
    console.log('[seed] В базе уже есть компании, пропускаю.');
    return;
  }

  // Получим админа (создан автоматически при init)
  const admin = await db.get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
  const adminId = admin?.id;

  // Иерархия: admin → manager → 2 sales
  let managerId;
  {
    const r = await db.run(
      `INSERT INTO users (email, password_hash, name, role, manager_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      'manager@example.com',
      hashPassword('manager123'),
      'Мария Менеджер',
      'manager',
      adminId,
    );
    managerId = r.lastInsertRowid;
  }

  const sales = [];
  for (const [email, name] of [
    ['alice@example.com', 'Алиса Продажник'],
    ['bob@example.com', 'Борис Продажник'],
  ]) {
    const r = await db.run(
      `INSERT INTO users (email, password_hash, name, role, manager_id)
       VALUES (?, ?, ?, 'sales', ?)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      email, hashPassword('sales123'), name, managerId,
    );
    sales.push(r.lastInsertRowid);
  }

  const [alice, bob] = sales;

  // Кладовщик (warehouse) — без менеджера, отдельная роль
  let warehouseId;
  {
    const r = await db.run(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES (?, ?, ?, 'warehouse')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      'warehouse@example.com',
      hashPassword('warehouse123'),
      'Кладовщик Кирилл',
    );
    warehouseId = r.lastInsertRowid;
  }

  // Компании
  const companyDefs = [
    ['ООО "Ромашка"', 'Производство', 'large', 50000000, alice],
    ['ГлобалКорп', 'Энергетика', 'enterprise', 200000000, alice],
    ['СофтДев', 'IT', 'medium', 15000000, bob],
    ['ЭкоФуд', 'Продукты питания', 'small', 2000000, bob],
  ];
  const companyIds = [];
  for (const [name, industry, size, revenue, owner] of companyDefs) {
    const r = await db.run(
      `INSERT INTO companies (name, industry, size, annual_revenue, owner_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      name, industry, size, revenue, owner,
    );
    companyIds.push(r.lastInsertRowid);
  }

  // Контакты
  const contactDefs = [
    ['Сергей', 'Волков', 'sergey@romashka.example', 'CTO', companyIds[0], alice],
    ['Елена', 'Соколова', 'elena@globalcorp.example', 'CEO', companyIds[1], alice],
    ['Дмитрий', 'Орлов', 'dmitry@softdev.example', 'Инженер', companyIds[2], bob],
  ];
  const contactIds = [];
  for (const [fn, ln, email, position, cid, owner] of contactDefs) {
    const r = await db.run(
      `INSERT INTO contacts (first_name, last_name, email, position, company_id, owner_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      fn, ln, email, position, cid, owner,
    );
    contactIds.push(r.lastInsertRowid);
  }

  // Лиды
  const leadDefs = [
    ['Иван', 'Петров', 'ivan@biztech.example', 'БизТех', 'website', 'new', 25000, alice],
    ['Анна', 'Смирнова', 'anna@futurecorp.example', 'ФьючерКорп', 'referral', 'contacted', 75000, alice],
    ['Михаил', 'Кузнецов', 'mihail@megainc.example', 'Мега Инк', 'cold_call', 'qualified', 120000, bob],
  ];
  for (const [fn, ln, email, cn, src, st, val, owner] of leadDefs) {
    await db.run(
      `INSERT INTO leads (first_name, last_name, email, company_name, source, status, estimated_value, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      fn, ln, email, cn, src, st, val, owner,
    );
  }

  // Сделки
  const dealDefs = [
    ['Ромашка: расширение Q2', 50000, 'qualified', 25, contactIds[0], companyIds[0], alice, false],
    ['ГлобалКорп: годовой контракт', 250000, 'proposal', 50, contactIds[1], companyIds[1], alice, false],
    ['СофтДев: внедрение', 80000, 'negotiation', 75, contactIds[2], companyIds[2], bob, false],
    ['Старая сделка (закрыта)', 30000, 'won', 100, null, companyIds[3], bob, true],
  ];
  for (const [title, amount, stage, prob, cid, compId, owner, closed] of dealDefs) {
    await db.run(
      `INSERT INTO deals (title, amount, stage, probability, contact_id, company_id, owner_id, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${closed ? 'NOW()' : 'NULL'})`,
      title, amount, stage, prob, cid, compId, owner,
    );
  }

  // Задачи
  const dueTomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const dueIn3Days = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  await db.run(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'call', 'Перезвонить Ромашке', dueTomorrow, 'deal', 1, alice,
  );
  await db.run(
    `INSERT INTO activities (type, subject, due_date, related_to_type, related_to_id, owner_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'meeting', 'Демо для ГлобалКорп', dueIn3Days, 'deal', 2, alice,
  );

  // Каталог товаров и прайсы по площадкам
  const productDefs = [
    {
      sku: 'A-1', name: 'Футболка XL', cost: 600,
      image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300',
      prices: { Wildberries: 1200, Ozon: 1300, Avito: 1100 },
    },
    {
      sku: 'A-2', name: 'Кепка', cost: 400,
      image: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=300',
      prices: { Wildberries: 800, Ozon: 850 },
    },
    {
      sku: 'B-1', name: 'Кружка керамическая', cost: 180,
      image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=300',
      prices: { Wildberries: 450, Ozon: 480, Avito: 400 },
    },
    {
      sku: 'C-7', name: 'Коробка передач (запчасть)', cost: 18000,
      image: null,
      prices: { Avito: 28000, 'Другое': 27000 },
    },
  ];
  for (const def of productDefs) {
    const r = await db.run(
      `INSERT INTO products (sku, name, image_url, cost_price, unit, active)
       VALUES (?, ?, ?, ?, 'шт', TRUE) RETURNING id`,
      def.sku, def.name, def.image, def.cost,
    );
    for (const [mp, price] of Object.entries(def.prices)) {
      await db.run(
        `INSERT INTO product_prices (product_id, marketplace, price)
         VALUES (?, ?, ?)`,
        r.lastInsertRowid, mp, price,
      );
    }
  }

  // Avito: заказы и платежи
  const orderDefs = [
    {
      ref: 'WB-100001', market: 'Wildberries', clientClass: 'B2C', client: 'И. Иванов',
      manager: managerId,
      items: [
        { sku: 'A-1', name: 'Футболка XL', qty: 2, price: 1200 },
        { sku: 'A-2', name: 'Кепка', qty: 1, price: 800 },
      ],
      status: 'new',
    },
    {
      ref: 'OZ-200345', market: 'Ozon', clientClass: 'B2C', client: 'А. Петрова',
      manager: managerId,
      items: [{ sku: 'B-1', name: 'Кружка', qty: 3, price: 450 }],
      status: 'reserved',
    },
    {
      ref: 'AVT-555', market: 'Avito', clientClass: 'B2B', client: 'ООО "Закупка"',
      manager: managerId,
      items: [
        { sku: 'C-7', name: 'Коробка передач', qty: 1, price: 28000 },
      ],
      status: 'shipped',
    },
  ];
  for (const o of orderDefs) {
    const total = o.items.reduce((s, i) => s + i.qty * i.price, 0);
    const r = await db.run(
      `INSERT INTO orders (reference_number, marketplace, client_classification, client_name,
                           total_amount, currency, status, manager_id,
                           warehouse_user_id, reserved_at, shipped_at)
       VALUES (?, ?, ?, ?, ?, 'RUB', ?, ?, ?,
               ${o.status === 'reserved' || o.status === 'shipped' ? 'NOW()' : 'NULL'},
               ${o.status === 'shipped' ? 'NOW()' : 'NULL'})
       RETURNING id`,
      o.ref, o.market, o.clientClass, o.client, total, o.status, o.manager,
      o.status === 'new' ? null : warehouseId,
    );
    const orderId = r.lastInsertRowid;
    for (const it of o.items) {
      await db.run(
        `INSERT INTO order_items (order_id, sku, name, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        orderId, it.sku, it.name, it.qty, it.price, it.qty * it.price,
      );
    }
  }

  // Платежи менеджера: один подтверждённый, один ждёт подтверждения
  await db.run(
    `INSERT INTO payments (manager_id, order_id, amount, currency, method, reference, status,
                          confirmed_by, confirmed_at)
     VALUES (?, 3, 28000, 'RUB', 'bank_transfer', 'TRX-2026-001', 'confirmed', ?, NOW())`,
    managerId, adminId,
  );
  await db.run(
    `INSERT INTO payments (manager_id, amount, currency, method, reference, status)
     VALUES (?, 1350, 'RUB', 'cash', 'CASH-001', 'pending')`,
    managerId,
  );

  // Демо-токен для внешних интеграций
  const demoToken = generateToken();
  await db.run(
    `INSERT INTO api_tokens (name, token_hash, token_prefix, scopes, created_by)
     VALUES (?, ?, ?, 'leads:create,orders:create', ?)`,
    'Демо: лендинг',
    hashToken(demoToken),
    tokenPrefix(demoToken),
    adminId,
  );

  // eslint-disable-next-line no-console
  console.log(
    '[seed] Демо-данные созданы.\n' +
    '  Иерархия: admin → Мария (manager) → Алиса, Борис (sales)\n' +
    '  Склад:    Кирилл (warehouse@example.com / warehouse123)\n' +
    '  Avito:    3 заказа в разных статусах, 2 платежа в кассе Марии\n' +
    '  Каталог:  4 товара с прайсами по площадкам\n' +
    `  API-токен для тестов внешних интеграций: ${demoToken}`,
  );
}

try {
  await seed();
} finally {
  await closeDb();
}
