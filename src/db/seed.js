// Скрипт для заполнения базы демо-данными.
// Использование: npm run seed
import { hashPassword } from '../auth.js';
import { db, ensureInitialized, closeDb } from '../db.js';

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

  // eslint-disable-next-line no-console
  console.log('[seed] Демо-данные созданы. Иерархия: admin → Мария (manager) → Алиса, Борис (sales)');
}

try {
  await seed();
} finally {
  await closeDb();
}
