import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales' CHECK(role IN ('admin', 'manager', 'sales')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  size TEXT CHECK(size IN ('small','medium','large','enterprise') OR size IS NULL),
  annual_revenue REAL,
  description TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  position TEXT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  position TEXT,
  source TEXT CHECK(source IN ('website','referral','cold_call','social','event','advertisement','other') OR source IS NULL),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','unqualified','converted')),
  estimated_value REAL,
  description TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  converted_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  converted_deal_id INTEGER,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  stage TEXT NOT NULL DEFAULT 'new' CHECK(stage IN ('new','qualified','proposal','negotiation','won','lost')),
  probability INTEGER NOT NULL DEFAULT 10 CHECK(probability BETWEEN 0 AND 100),
  expected_close_date TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  lost_reason TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('call','email','meeting','task')),
  subject TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  related_to_type TEXT CHECK(related_to_type IN ('contact','company','lead','deal') OR related_to_type IS NULL),
  related_to_id INTEGER,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  related_to_type TEXT NOT NULL CHECK(related_to_type IN ('contact','company','lead','deal')),
  related_to_id INTEGER NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_due ON activities(due_date);
CREATE INDEX IF NOT EXISTS idx_activities_related ON activities(related_to_type, related_to_id);
CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_related ON notes(related_to_type, related_to_id);

-- Иерархия: менеджер пользователя (для дерева)
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);

-- Блоки доступа для менеджера: 'sales' (продажи CRM) и/или 'direct' (прямые продажи).
-- comma-separated; NULL/пусто = оба блока.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_blocks TEXT;

-- Расширяем enum роли до 4 значений (admin/manager/sales/warehouse).
-- CHECK-ограничение нужно пересоздать, иначе старая проверка не пропустит warehouse.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_role_check' AND table_name = 'users'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'manager', 'sales', 'warehouse', 'rop', 'aus'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Приглашения для регистрации новых пользователей
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(invited_by);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invitations_role_check' AND table_name = 'invitations'
  ) THEN
    ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
  END IF;
  ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('admin', 'manager', 'sales', 'warehouse', 'rop', 'aus'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Модуль «Прямые продажи» (Avito): заказы, позиции заказа, платежи (касса)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  reference_number TEXT,
  marketplace TEXT,
  client_classification TEXT,
  client_name TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','reserved','shipped','completed','cancelled')),
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reserved_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  method TEXT CHECK(method IN ('cash','card','bank_transfer','other') OR method IS NULL),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','rejected')),
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_manager ON orders(manager_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_marketplace ON orders(marketplace);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_manager ON payments(manager_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- Обратная связь от пользователей (вопросы / баги / предложения)
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK(category IN ('bug','question','suggestion','other')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','in_progress','closed')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  admin_reply TEXT,
  attachments JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

-- Интеграции с внешними источниками: токены, вебхуки, уведомления
CREATE TABLE IF NOT EXISTS api_tokens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'leads:create,orders:create',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL DEFAULT '*',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- Каталог товаров (с возможной синхронизацией с МойСклад)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  image_url TEXT,
  cost_price REAL NOT NULL DEFAULT 0,
  stock REAL,
  unit TEXT DEFAULT 'шт',
  description TEXT,
  external_source TEXT,
  external_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(external_source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
-- Поставщик (из МойСклад, для фильтра в каталоге)
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT;

-- Прайсы по площадкам и складам: товар + площадка + склад → цена
CREATE TABLE IF NOT EXISTS product_prices (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_prices_product ON product_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_marketplace ON product_prices(marketplace);

-- Расширение позиций заказа: ссылка на товар, картинка, цена из прайса (для отслеживания отклонений)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS catalog_price REAL;
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Прайс на уровне заказа: способ оплаты и отклонение цены от прайса (для кассы и воронки).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_deviation REAL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recommended_total REAL;
-- QR код отгрузки (обязателен для Avito + Авито доставка при резервировании)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_qr TEXT;

-- Расписание отгрузок: глобальная единственная запись (id всегда 1).
-- days = comma-separated weekdays: mon,tue,wed,thu,fri,sat,sun
-- cutoff_time = HH:MM, после которого заказ уезжает на следующий отгрузочный день.
CREATE TABLE IF NOT EXISTS shipping_schedule (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  days TEXT NOT NULL DEFAULT 'mon,wed,fri',
  cutoff_time TEXT NOT NULL DEFAULT '14:00',
  notes TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO shipping_schedule (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Произвольные настройки приложения (key → JSON). Используется для правил цен:
--   pricing.payment_methods — [{key,label,percent}]
--   pricing.order_tiers     — [{threshold,percent}]
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// Reuse the pool across warm serverless invocations.
function getPool() {
  if (globalThis.__crmPool) return globalThis.__crmPool;
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Configure it in .env or in your Vercel project settings.');
  }
  const needsSsl =
    config.env === 'production' ||
    /supabase\.com|render\.com|neon\.tech|amazonaws\.com/.test(config.databaseUrl);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.env === 'production' ? 1 : 5,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[pg] pool error', err);
  });
  globalThis.__crmPool = pool;
  return pool;
}

function convertSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function rawQuery(client, sql, params) {
  return client.query(convertSql(sql), params);
}

function makeApi(client) {
  return {
    async get(sql, ...params) {
      const r = await rawQuery(client, sql, params);
      return r.rows[0];
    },
    async all(sql, ...params) {
      const r = await rawQuery(client, sql, params);
      return r.rows;
    },
    async run(sql, ...params) {
      const r = await rawQuery(client, sql, params);
      return { changes: r.rowCount, rows: r.rows, lastInsertRowid: r.rows[0]?.id };
    },
    prepare(sql) {
      return {
        run: (...args) => this.run(sql, ...args),
        get: (...args) => this.get(sql, ...args),
        all: (...args) => this.all(sql, ...args),
      };
    },
  };
}

export const db = {
  ...makeApi({ query: (text, params) => getPool().query(text, params) }),
  async withTransaction(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const txDb = makeApi(client);
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
};

export async function ensureInitialized() {
  if (globalThis.__crmInitialized) return;
  let lastErr;
  // Холодный старт serverless-функции иногда срывает первый коннект к пулеру
  // Supabase. Повторяем со свежим пулом, чтобы разовый сбой не ронял запрос.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const pool = getPool();
      // Схема уже создана после первого деплоя — не гоняем весь DDL на каждом
      // холодном старте. Тяжёлую схему запускаем только если базовой таблицы нет.
      const probe = await pool.query("SELECT to_regclass('public.users') AS t");
      if (!probe.rows[0]?.t) {
        await pool.query(SCHEMA);
        await ensureDefaultAdmin();
      }
      // Лёгкие миграции для уже существующей БД (заодно освежают схему на этом соединении).
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock REAL');
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_by_store JSONB');
      await pool.query(
        `CREATE TABLE IF NOT EXISTS app_settings (
           key TEXT PRIMARY KEY,
           value JSONB NOT NULL,
           updated_by INTEGER,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_deviation REAL');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS recommended_total REAL');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_qr TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_phone TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS avito_dialog_url TEXT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS access_blocks TEXT');
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT');
      // Касса: комиссия площадки и тип транзакции (income/expense), привязка авто-транзакции к заказу.
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission REAL');
      await pool.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'income'");
      // Возвраты: отменённый заказ → склад возвращает в сток или списывает (с пруфом-фото).
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_status TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_proof TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_resolved_by INTEGER');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_resolved_at TIMESTAMPTZ');
      // Склад списания заказа (для МойСклад) + потерянные товары (аннулирование админом).
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS loss_voided BOOLEAN DEFAULT FALSE');
      // Из какого статуса был отменён заказ (для статистики «отказ до поступления»).
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_from_status TEXT');
      // Связь с родительским заказом, если этот создан разделением.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id INTEGER');
      // МойСклад: ID документов в МС, чтобы знать что и где обновлять/удалять.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ms_customer_order_id TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ms_demand_id TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ms_return_id TEXT');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ms_loss_id TEXT');
      // Очередь задач для синхронизации с МС (асинхронно с ретраями).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ms_jobs (
          id SERIAL PRIMARY KEY,
          order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','running','done','failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          ms_document_id TEXT,
          scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_ms_jobs_pending ON ms_jobs(scheduled_at) WHERE status = \'pending\'',
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ms_jobs_order ON ms_jobs(order_id)');
      // Уценка: новый товар на каждую уникальную уценённую позицию (своя цена,
      // создаётся при resolution='markdown' возврата). Ссылается на исходный
      // товар и заказ-источник.
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_markdown BOOLEAN DEFAULT FALSE');
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS markdown_of_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS markdown_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_products_markdown ON products(is_markdown) WHERE is_markdown = TRUE');
      // Аудит-лог действий пользователей (заказы, склад, прайс и т.п.) — для
      // прозрачности и расследований («куда делся заказ?»).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name TEXT,
          user_role TEXT,
          action TEXT NOT NULL,
          entity_type TEXT,
          entity_id INTEGER,
          details JSONB,
          ip TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)');
      // Backfill stock_by_store у уже созданных markdown-товаров (фикс задним числом
      // для тех что создались до фикса, когда мы ещё не заполняли поле сразу).
      await pool.query(`
        UPDATE products
        SET stock_by_store = jsonb_build_array(
          jsonb_build_object('store', 'Склад МСК (Электросталь) УЦЕНКА', 'stock', stock, 'reserve', 0)
        ), updated_at = NOW()
        WHERE is_markdown = TRUE
          AND active = TRUE
          AND (stock_by_store IS NULL OR jsonb_typeof(stock_by_store) <> 'array' OR jsonb_array_length(stock_by_store) = 0)
      `);
      // Обратная связь от пользователей (вопросы / баги / предложения).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          category TEXT NOT NULL DEFAULT 'other'
            CHECK(category IN ('bug','question','suggestion','other')),
          subject TEXT NOT NULL,
          message TEXT NOT NULL,
          context TEXT,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK(status IN ('open','in_progress','closed')),
          resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          resolved_at TIMESTAMPTZ,
          admin_reply TEXT,
          attachments JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)');
      // Вложения к обращению: массив объектов { filename, content (data URL), type, size }.
      // Хранится в БД — для бага «как воспроизвести» удобно скриншот посмотреть.
      await pool.query('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT NULL');
      // МАХ-бот: chat_id пользователя для пушей; одноразовый код для привязки (с TTL).
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_chat_id BIGINT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_bind_code TEXT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_bind_expires TIMESTAMPTZ');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_users_max_chat ON users(max_chat_id) WHERE max_chat_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_users_max_code ON users(max_bind_code) WHERE max_bind_code IS NOT NULL');
      // Прайс с привязкой к складу: товар × канал × склад. Старое UNIQUE(product,market) снимаем.
      await pool.query("ALTER TABLE product_prices ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT ''");
      await pool.query('ALTER TABLE product_prices DROP CONSTRAINT IF EXISTS product_prices_product_id_marketplace_key');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_prices_pmw ON product_prices (product_id, marketplace, warehouse)');
      // Индексы под частые фильтры/сортировки (ускоряют списки заказов/возвратов и каталог).
      await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_return_status ON orders(return_status) WHERE return_status IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier)');
      // Строгая модель «канал+склад»: цены без склада недопустимы — чистим их на каждом
      // холодном старте (самовосстановление, если что-то просочилось из старого клиента).
      await pool.query("DELETE FROM product_prices WHERE warehouse IS NULL OR warehouse = ''");
      // Обновляем CHECK роли (добавлены rop, aus, finance) — для users и invitations.
      // DO ... EXCEPTION на случай гонки нескольких холодных стартов лямбд (без него —
      // 42710 duplicate_object, если другая лямбда уже создала constraint между DROP и ADD).
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
          ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
          ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      globalThis.__crmInitialized = true;
      return;
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.error(`[db-init] attempt ${attempt}/3 failed:`, e?.code, e?.message);
      try { await globalThis.__crmPool?.end(); } catch { /* ignore */ }
      globalThis.__crmPool = null;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr;
}

async function ensureDefaultAdmin() {
  const r = await db.get('SELECT COUNT(*)::int AS count FROM users');
  if (r.count > 0) return;
  const hash = bcrypt.hashSync(config.admin.password, 10);
  await db.run(
    `INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'admin')`,
    config.admin.email,
    hash,
    config.admin.name,
  );
  // eslint-disable-next-line no-console
  console.log(`[db] Создан админ по умолчанию: ${config.admin.email} (поменяйте ADMIN_PASSWORD в .env!)`);
}

export async function closeDb() {
  if (globalThis.__crmPool) {
    await globalThis.__crmPool.end();
    globalThis.__crmPool = null;
    globalThis.__crmInitialized = false;
  }
}
