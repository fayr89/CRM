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

-- Обзвонные кампании: список потенциальных клиентов, распределённых на менеджеров.
--   type='production_order' — ищем заказчиков на наше производство
--   type='product_sales'    — продаём наши готовые изделия
-- Скрипт — свободный текст (description); required_points — обязательные пункты
-- разговора (короткий чек-лист, JSONB массив строк).
CREATE TABLE IF NOT EXISTS calling_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'production_order' CHECK(type IN ('production_order','product_sales')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','paused','closed')),
  description TEXT,
  required_points JSONB DEFAULT '[]'::jsonb,
  source TEXT,
  -- FK на projects добавляется в миграции (в SCHEMA-константе projects ещё нет).
  default_project_id INTEGER,
  target_calls_per_day INTEGER NOT NULL DEFAULT 30,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- История попыток звонка. Пишется каждый раз, когда менеджер фиксирует результат.
-- outcome совпадает по значениям с leads.qualification и после записи попытки
-- копируется в лид (последнее слово — за последней попыткой).
CREATE TABLE IF NOT EXISTS call_attempts (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome TEXT NOT NULL CHECK(outcome IN (
    'no_answer','not_interested','callback','qualified','meeting_scheduled','converted','dead'
  )),
  duration_sec INTEGER,
  note TEXT,
  next_call_at TIMESTAMPTZ,
  covered_points JSONB DEFAULT '[]'::jsonb
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
    // 10 сек на connect: Supabase pooler отвечает мгновенно, но upstream БД
    // после паузы просыпается 5-15 сек. Крутим retry с backoff — суммарно
    // 4×10s + backoff ≈ 47 сек, укладывается в лямбду 60s. См. ensureInitialized.
    connectionTimeoutMillis: 10000,
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

// БАМПАЙ ПРИ КАЖДОМ ДОБАВЛЕНИИ МИГРАЦИИ. Текущие миграции прогоняются
// только если запись в app_settings.schema_version отличается. Это экономит
// ~500-2000мс на каждом холодном старте serverless-лямбды.
const SCHEMA_VERSION = 41;

// Транзиентные ошибки коннекта — стоит ретраить (БД просыпается, сетевой сбой).
// Явные не-транзиентные (auth, protocol) — ретрай не поможет, лучше сразу упасть.
function isTransientDbError(e) {
  const code = e?.code || '';
  const msg = String(e?.message || '').toLowerCase();
  return (
    code === '08006' || code === '08001' || code === '08000' || code === '08003' || code === '08004'
    || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND'
    || code === 'ECONNRESET' || code === 'EAI_AGAIN'
    || msg.includes('timeout') || msg.includes('connection terminated')
    || msg.includes('connect etimedout') || msg.includes('failed to connect')
  );
}

export async function ensureInitialized() {
  if (globalThis.__crmInitialized) return;
  let lastErr;
  // Холодный старт serverless-функции иногда срывает первый коннект к пулеру
  // Supabase. Плюс сам Supabase может паузить БД при длительной неактивности —
  // просыпается 5-15 сек. Ретраим до 4 раз с exponential backoff (0.5s, 2s, 4s).
  // Не-транзиентные ошибки (auth, protocol) не ретраим — только теряем время.
  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [500, 2000, 4000]; // между попытками 1→2, 2→3, 3→4
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const pool = getPool();
      // Схема уже создана после первого деплоя — не гоняем весь DDL на каждом
      // холодном старте. Тяжёлую схему запускаем только если базовой таблицы нет.
      const probe = await pool.query("SELECT to_regclass('public.users') AS t");
      const freshDb = !probe.rows[0]?.t;
      if (freshDb) {
        await pool.query(SCHEMA);
        await ensureDefaultAdmin();
      }

      // Гейт миграций: на холодном старте читаем сохранённую schema_version.
      // Если совпадает с текущей — пропускаем все ALTER/CREATE INDEX (это
      // 80+ запросов, на холодной лямбде они дают +0.5-2с).
      let needsMigration = freshDb;
      if (!freshDb) {
        try {
          const v = await pool.query(`SELECT value FROM app_settings WHERE key = 'schema_version'`);
          const stored = v.rows[0]?.value;
          if (stored !== SCHEMA_VERSION) needsMigration = true;
        } catch {
          // app_settings ещё нет (старая БД) — нужно прогнать миграции.
          needsMigration = true;
        }
      }

      if (!needsMigration) {
        globalThis.__crmInitialized = true;
        return;
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
      // Связь вывод↔комиссия: при списании со счёта формируется ДВЕ транзакции
      // (одна на сумму к выводу, одна на комиссию). parent_payment_id у комиссии
      // указывает на родительский «вывод». При удалении родителя комиссия каскадно
      // удаляется — данные не висят сиротами.
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS parent_payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_parent ON payments(parent_payment_id) WHERE parent_payment_id IS NOT NULL');
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
      // Flow апрува: после исполнения админом статус → 'awaiting_approval', автор
      // обращения подтверждает «принято» (closed) или отклоняет с причиной (обратно в open).
      // Расширяем CHECK-констрейнт, добавляем колонку rejected_reason.
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_check;
          ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
            CHECK (status IN ('open','in_progress','awaiting_approval','closed'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await pool.query('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rejected_reason TEXT');
      // Thread обсуждения внутри обращения: админ может задать уточняющие вопросы,
      // автор отвечает. У сообщения роль помечается ('admin' или 'author' — для
      // визуального различения, даже если admin потом сменится).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback_messages (
          id BIGSERIAL PRIMARY KEY,
          feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name TEXT,
          role TEXT NOT NULL CHECK (role IN ('admin', 'author')),
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_msgs_fid ON feedback_messages(feedback_id, created_at)');
      // МАХ-бот: chat_id пользователя для пушей; одноразовый код для привязки (с TTL).
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_chat_id BIGINT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_bind_code TEXT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS max_bind_expires TIMESTAMPTZ');
      // Способ оплаты по умолчанию: при старте чистой БД — Авито-доставка.
      // Если запись уже есть (DO NOTHING) — не трогаем выбор админа.
      await pool.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('payment_method.default', '"avito_delivery"'::jsonb, NOW())
        ON CONFLICT (key) DO NOTHING
      `);
      // Заметка для менеджера (склад не видит). Хранится отдельно от общих notes.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_note TEXT');
      // pg_trgm для умного поиска товаров: многословный + similarity (опечатки).
      // Если расширение недоступно — миграция не падает (catch), поиск работает в режиме fallback.
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[db-init] pg_trgm unavailable (search будет в обычном ILIKE):', e.message);
      }
      // AI-предложения: inbox для админа от AI-ассистента. Каждое предложение
      // привязано к feedback (опционально), описывает что AI хочет сделать.
      // Админ через UI выбирает: принять / на доработку (с заметкой) / отклонить.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_proposals (
          id BIGSERIAL PRIMARY KEY,
          feedback_id INTEGER REFERENCES feedback(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          category TEXT,
          risk TEXT CHECK (risk IN ('low','medium','high')) DEFAULT 'medium',
          source TEXT,
          proposed_changes JSONB,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','approved','rejected','revision','done')),
          admin_decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          admin_decision_at TIMESTAMPTZ,
          admin_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_proposals(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_proposals_feedback ON ai_proposals(feedback_id) WHERE feedback_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_proposals_created ON ai_proposals(created_at DESC)');
      // Тред сообщений на предложении: админ и AI пишут заметки несколько раз
      // (а не одной admin_notes). Полезно для уточнений до/после решения.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_proposal_messages (
          id BIGSERIAL PRIMARY KEY,
          proposal_id BIGINT NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name TEXT,
          role TEXT,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_proposal_messages_proposal ON ai_proposal_messages(proposal_id, created_at)');
      // Баннеры уведомлений сверху страницы (info/warning) — админ-управляемые.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notice_banners (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'info'
            CHECK (kind IN ('info','warning','success','error')),
          starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ends_at TIMESTAMPTZ NOT NULL,
          dismissible BOOLEAN NOT NULL DEFAULT TRUE,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_notice_banners_window ON notice_banners(starts_at, ends_at)');
      // Пользовательские настройки уведомлений: для каких типов слать пуш в МАХ.
      // Отсутствие строки = включено по умолчанию (default-on). enabled=FALSE = выключено.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_notification_prefs (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          notification_type TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, notification_type)
        )
      `);
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
      // Обновляем CHECK роли — для users и invitations. ВАЖНО: список ролей
      // должен совпадать с финальным (включая производственные director_prod/
      // foreman/master/supply) — миграции гейтятся ОДНОЙ schema_version и при
      // бампе прогоняются ВСЕ блоки заново. Урезанный список здесь уронил прод
      // 2026-06-11: ADD CONSTRAINT упёрся в существующего director_prod
      // (check_violation не ловился EXCEPTION-ом duplicate_object).
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
          ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance','director_prod','foreman','master','supply'));
        EXCEPTION WHEN others THEN
          RAISE WARNING 'users_role_check (early) migration: %', SQLERRM;
        END $$;
      `);
      await pool.query(`
        DO $$ BEGIN
          ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
          ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance','director_prod','foreman','master','supply'));
        EXCEPTION WHEN others THEN
          RAISE WARNING 'invitations_role_check (early) migration: %', SQLERRM;
        END $$;
      `);
      // Вложения в тредах обращений: позволяет прикреплять файлы к ответам в переписке.
      await pool.query('ALTER TABLE feedback_messages ADD COLUMN IF NOT EXISTS attachments JSONB');
      // Проекты: справочник для классификации лидов/сделок/контактов/компаний.
      // Админ управляет списком, у каждого есть имя+цвет (для стикера). active=false
      // прячет из выпадашек при создании, но не удаляет с уже привязанных записей.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#6366f1',
          description TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Привязка проекта к лидам/сделкам/контактам/компаниям. SET NULL при удалении
      // проекта, чтобы случайная очистка справочника не каскадно убивала записи.
      await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE deals ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE companies ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id) WHERE project_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id) WHERE project_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id) WHERE project_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_companies_project ON companies(project_id) WHERE project_id IS NOT NULL');
      // Квалификация лида: 4 опциональных поля, заполняются при первом контакте.
      // Хранятся как TEXT (свобода будущих значений) — UI ограничивает выпадашкой,
      // но API не отвергает чужие значения, чтобы внешний интейк не падал.
      await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS purchase_frequency TEXT');
      await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS expected_volume REAL');
      await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS buy_readiness TEXT');
      await pool.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS classification TEXT');
      // Единый прайс «Общий прайс»: раньше Avito-цены были единственным прайсом
      // у клиента, теперь распространяем на B2B и все площадки. Идемпотентно.
      await pool.query(
        `UPDATE product_prices SET marketplace = 'Общий прайс' WHERE marketplace = 'Avito'`,
      );

      // ===== Производственный модуль (SCHEMA_VERSION 21) =====
      // Материалы — отдельная сущность, не путать с products (готовые товары).
      // ms_id — id номенклатуры в МойСклад, заполняется после синхронизации.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS materials (
          id BIGSERIAL PRIMARY KEY,
          sku TEXT,
          name TEXT NOT NULL,
          unit TEXT NOT NULL DEFAULT 'шт',
          cost_price REAL NOT NULL DEFAULT 0,
          supplier TEXT,
          warehouse TEXT,
          ms_id TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_materials_sku ON materials(sku)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_materials_active ON materials(active)');

      // Техкарта: товар + норма труда + список (материал, норма на 1 ед).
      // labor_minutes_per_unit × app_settings.production.labor_rate_per_minute = стоимость труда.
      // ms_id — id processingplan в МойСклад.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processing_plans (
          id BIGSERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          labor_minutes_per_unit REAL NOT NULL DEFAULT 0,
          ms_id TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (product_id)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processing_plan_items (
          id BIGSERIAL PRIMARY KEY,
          plan_id BIGINT NOT NULL REFERENCES processing_plans(id) ON DELETE CASCADE,
          material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
          qty_per_unit REAL NOT NULL CHECK (qty_per_unit > 0)
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON processing_plan_items(plan_id)');

      // Производственный заказ: план выпуска товара штуками за период.
      // status: draft|approved|in_progress|done|cancelled.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_orders (
          id BIGSERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          plan_qty INTEGER NOT NULL CHECK (plan_qty > 0),
          fact_qty INTEGER NOT NULL DEFAULT 0,
          period_from DATE NOT NULL,
          period_to DATE NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','approved','in_progress','done','cancelled')),
          foreman_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          notes TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_prod_orders_status ON production_orders(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_prod_orders_foreman ON production_orders(foreman_id)');

      // Дневная разбивка плана: на каждый день период — plan_qty и fact_qty.
      // backdated=true ставится автоматически если факт ввели не в тот же день.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_order_days (
          id BIGSERIAL PRIMARY KEY,
          production_order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
          day DATE NOT NULL,
          plan_qty INTEGER NOT NULL DEFAULT 0,
          fact_qty INTEGER NOT NULL DEFAULT 0,
          backdated BOOLEAN NOT NULL DEFAULT FALSE,
          over_plan BOOLEAN NOT NULL DEFAULT FALSE,
          note TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (production_order_id, day)
        )
      `);

      // Журнал изменений плана: что/кто/когда/причина. Только для значимых правок
      // (изменение plan_qty, периода, переутверждение).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_plan_changes (
          id BIGSERIAL PRIMARY KEY,
          production_order_id BIGINT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          old_value JSONB,
          new_value JSONB,
          reason TEXT,
          changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Подряды: клиентский заказ на изготовление с фиксированными этапами.
      // status: draft|in_progress|done|cancelled. paid_amount — что клиент уже оплатил.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contracts (
          id BIGSERIAL PRIMARY KEY,
          client_name TEXT NOT NULL,
          client_phone TEXT,
          client_company TEXT,
          total_amount REAL NOT NULL DEFAULT 0,
          paid_amount REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'RUB',
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','in_progress','done','cancelled')),
          manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          description TEXT,
          notes TEXT,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_manager ON contracts(manager_id)');

      // Этапы подряда — фиксированный enum по ТЗ. По мере прохождения этапа
      // мастер закрывает (fact_date, closed_by). plan_date — целевая дата.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_stages (
          id BIGSERIAL PRIMARY KEY,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          stage TEXT NOT NULL
            CHECK (stage IN ('measure','cut','weld','paint','ship')),
          plan_date DATE,
          fact_date DATE,
          closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          closed_at TIMESTAMPTZ,
          note TEXT,
          UNIQUE (contract_id, stage)
        )
      `);

      // Материалы списываются на подряд по факту использования.
      // unit_price фиксируется в момент списания (cost_price материала может меняться).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_materials (
          id BIGSERIAL PRIMARY KEY,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
          qty REAL NOT NULL CHECK (qty > 0),
          unit_price REAL NOT NULL CHECK (unit_price >= 0),
          consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          consumed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note TEXT
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contract_materials_contract ON contract_materials(contract_id)');

      // Журнал труда по подряду: минуты × ставка → стоимость труда.
      // rate берётся из app_settings.production.labor_rate_per_minute на момент записи.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_labor_logs (
          id BIGSERIAL PRIMARY KEY,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          minutes REAL NOT NULL CHECK (minutes > 0),
          rate_per_minute REAL NOT NULL CHECK (rate_per_minute >= 0),
          amount REAL NOT NULL,
          performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          note TEXT
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contract_labor_contract ON contract_labor_logs(contract_id)');

      // Прочие прямые расходы по подряду (доставка, разовые услуги и т.п.).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_other_expenses (
          id BIGSERIAL PRIMARY KEY,
          contract_id BIGINT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          amount REAL NOT NULL CHECK (amount >= 0),
          kind TEXT,
          note TEXT,
          spent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // Расширение CHECK-роли: добавлены 4 производственных роли + finance
      // (исторически в IMPERSONATE_ROLES был, но в БД-чеке не значился).
      await pool.query(`DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'users_role_check' AND table_name = 'users'
          ) THEN
            ALTER TABLE users DROP CONSTRAINT users_role_check;
          END IF;
          ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance','director_prod','foreman','master','supply'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;`);
      await pool.query(`DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'invitations_role_check' AND table_name = 'invitations'
          ) THEN
            ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
          END IF;
          ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
            CHECK (role IN ('admin','manager','sales','warehouse','rop','aus','finance','director_prod','foreman','master','supply'));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;`);

      // ===== Конец производственного модуля =====

      // Комиссия площадки на заказе: при завершении заказа авто-создаётся расход в Кассе.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission NUMERIC DEFAULT 0');
      // Проект: связь заказа и платежа с проектом (для раздельной кассы по проектам).
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id) WHERE project_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id) WHERE project_id IS NOT NULL');

      // ===== Доходность производства (SCHEMA_VERSION 23) =====
      // Помечаем проекты как «производственные»: доход с их сделок/заказов/
      // подрядов попадает в P&L производства. Например ЧПБ — полимерная краска.
      await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_production BOOLEAN NOT NULL DEFAULT FALSE');
      // Подряду тоже нужен project_id — раньше связи не было (auto-claude добавил
      // только для orders/payments). Без этого подряды нельзя приписать к
      // производственному проекту.
      await pool.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id) WHERE project_id IS NOT NULL');
      // Ручные расходы производства: зарплаты, аренда, оборудование, налоги
      // и т.п. — то, что не привязано к конкретному подряду. Записывает
      // директор производства/админ. category — свободный текст («ФОТ»,
      // «аренда», «оборудование», ...).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_expenses (
          id BIGSERIAL PRIMARY KEY,
          amount REAL NOT NULL CHECK (amount >= 0),
          category TEXT,
          description TEXT,
          spent_at DATE NOT NULL DEFAULT CURRENT_DATE,
          recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_production_expenses_spent ON production_expenses(spent_at DESC)');

      // ===== Этапы техкарты (SCHEMA_VERSION 24) =====
      // Разбивка нормы труда по этапам (раскрой, сварка, покраска и т.п.).
      // labor_minutes_per_unit на processing_plans остаётся как fallback, но
      // если есть строки stages — эффективное время труда = SUM(minutes).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processing_plan_stages (
          id BIGSERIAL PRIMARY KEY,
          plan_id BIGINT NOT NULL REFERENCES processing_plans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          minutes REAL NOT NULL DEFAULT 0 CHECK (minutes >= 0),
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_plan_stages_plan ON processing_plan_stages(plan_id, sort_order)');

      // ===== Поля синхронизации с МС (SCHEMA_VERSION 25) =====
      await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS ms_synced_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS ms_sync_error TEXT');
      // Себестоимость операции в производственном заказе (исторический snapshot
      // на момент «выполнили заказ»): материалы + труд × ставка.
      await pool.query('ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS cost_total REAL NOT NULL DEFAULT 0');
      await pool.query('ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS ms_processing_id TEXT');

      // ===== Bug fix: waiting_stock в CHECK constraint orders.status (SCHEMA_VERSION 26) =====
      await pool.query(`
        DO $$
        BEGIN
          ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
          ALTER TABLE orders ADD CONSTRAINT orders_status_check
            CHECK(status IN ('new','reserved','shipped','completed','cancelled','waiting_stock'));
        EXCEPTION WHEN others THEN
          RAISE WARNING 'orders status check migration: %', SQLERRM;
        END $$
      `);

      // ===== Составной индекс прайса (SCHEMA_VERSION 27) =====
      // Lookup цены всегда по триплету (product_id, marketplace, warehouse) —
      // листинг заказов делает его на каждую позицию. Одиночные индексы по
      // product_id/marketplace остаются (используются другими запросами).
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_product_prices_lookup
         ON product_prices(product_id, marketplace, warehouse)`,
      );

      // ===== Разбивка по типоразмерам в техкарте (SCHEMA_VERSION 28) =====
      await pool.query(
        `ALTER TABLE processing_plan_items ADD COLUMN IF NOT EXISTS sizes JSONB`,
      );

      // ===== Склад пользователя (SCHEMA_VERSION 29) =====
      // Для роли «склад»: привязка к конкретному складу отгрузки (orders.warehouse).
      // Без этого поля пользователь «склад» видит все заказы всех складов.
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouse TEXT');

      // ===== Подтверждение отгрузки менеджером + мультисклад (SCHEMA_VERSION 30) =====
      // manager_shipping_confirmed: менеджер отмечает факт отгрузки без смены фин.статуса.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_shipping_confirmed BOOLEAN DEFAULT FALSE');
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_shipping_confirmed_at TIMESTAMPTZ');
      // warehouses: JSON-массив складов для роли «склад» (мультисклад).
      // Если задан — фильтрует заказы по ANY(warehouses). Иначе — по warehouse (одиночный).
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouses JSONB DEFAULT NULL');

      // ===== PWA push-подписки (SCHEMA_VERSION 31) =====
      // Web Push API: клиент подписывается через SW → мы храним endpoint + ключи
      // (p256dh, auth) и шлём пуш через web-push. Уник по (user_id, endpoint) —
      // один юзер может подписаться с нескольких устройств.
      await pool.query(
        `CREATE TABLE IF NOT EXISTS push_subscriptions (
           id SERIAL PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           endpoint TEXT NOT NULL,
           p256dh TEXT NOT NULL,
           auth TEXT NOT NULL,
           user_agent TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           last_used_at TIMESTAMPTZ,
           UNIQUE(user_id, endpoint)
         )`,
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)');

      // ===== Индексы для горячих bootstrap-запросов (SCHEMA_VERSION 32) =====
      // /api/bootstrap делает 5+ COUNT-ов по user_id/status на каждом заходе.
      // Без этих индексов при заметном каталоге запросы делают seq scan.
      await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status) WHERE status IN (\'open\',\'in_progress\',\'awaiting_approval\')');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_user_status ON feedback(user_id, status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_proposals(status) WHERE status IN (\'pending\',\'revision\')');
      // Горячие запросы по orders (list, filter по статусу, дате, менеджеру).
      await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_manager_status ON orders(manager_id, status) WHERE manager_id IS NOT NULL');
      // order_items — используется в аналитике/dashboard.
      await pool.query('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)');

      // ===== Модуль «Обзвон» (SCHEMA_VERSION 33) =====
      // Таблицы кампаний и попыток — на случай существующих БД (в SCHEMA-константе
      // уже есть CREATE IF NOT EXISTS для чистых установок).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS calling_campaigns (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'production_order' CHECK(type IN ('production_order','product_sales')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','paused','closed')),
          description TEXT,
          required_points JSONB DEFAULT '[]'::jsonb,
          source TEXT,
          default_project_id INTEGER,
          target_calls_per_day INTEGER NOT NULL DEFAULT 30,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // FK на projects добавляем отдельно — здесь projects точно уже существует.
      // Идемпотентно: проверяем через pg_constraint.
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calling_campaigns_default_project_fk') THEN
            ALTER TABLE calling_campaigns
              ADD CONSTRAINT calling_campaigns_default_project_fk
              FOREIGN KEY (default_project_id) REFERENCES projects(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS call_attempts (
          id SERIAL PRIMARY KEY,
          lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          outcome TEXT NOT NULL CHECK(outcome IN (
            'no_answer','not_interested','callback','qualified','meeting_scheduled','converted','dead'
          )),
          duration_sec INTEGER,
          note TEXT,
          next_call_at TIMESTAMPTZ,
          covered_points JSONB DEFAULT '[]'::jsonb
        )
      `);

      // Флаги пользователя: admin даёт право участвовать в обзвоне (is_active_caller);
      // сам менеджер может временно поставить «не готов» (calling_ready=false, напр.
      // ушёл в отпуск); calling_capacity — сколько «в работе» лидов ему даём
      // одновременно, дефолт 30 (потом настраивается).
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active_caller BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS calling_ready BOOLEAN NOT NULL DEFAULT TRUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS calling_capacity INTEGER NOT NULL DEFAULT 30`);

      // Расширения leads под обзвон. Существующие лиды получают NULL — не мешают.
      // qualification — расширенный статус, дублирует leads.status для UI обзвона
      // (существующий status используется другими флоу — не трогаем).
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES calling_campaigns(id) ON DELETE SET NULL`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS city TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS website TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS inn TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS size_hint TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS raw_import_row JSONB`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualification TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_call_at TIMESTAMPTZ`);
      // priority — A/B/C (или NULL). Определяет порядок звонков: A → B → C → NULL.
      // TEXT без CHECK-constraint: внешние базы могут иметь свои шкалы, не хочу
      // отбрасывать импорт из-за экзотических значений.
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS priority TEXT`);
      // region — регион как отдельное поле (для фильтрации/сортировки).
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS region TEXT`);
      // ЛПР — ФИО, должность, прямой телефон (отдельно от phone ресепшн).
      // Менеджер получает их у ресепшн и потом уже звонит напрямую.
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lpr_name TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lpr_position TEXT`);
      await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lpr_phone TEXT`);

      // Индексы обзвона: горячие запросы — «мои задачи на сегодня» и «история попыток».
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_owner_qualification ON leads(owner_id, qualification, next_call_at) WHERE campaign_id IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id) WHERE campaign_id IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON call_attempts(lead_id, at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_attempts_user_at ON call_attempts(user_id, at DESC)`);

      // ===== Модуль «Просчёты производства» (SCHEMA_VERSION 36) =====
      // Заявка на просчёт: менеджер описывает изделие + прикладывает файлы,
      // производство заполняет cost_price/client_price/reward. Менеджер НЕ
      // видит cost_price — только client_price и вычисленное вознаграждение.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_requests (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          deadline TIMESTAMPTZ,
          manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
            'draft','awaiting_cost','priced','negotiating','approved',
            'in_progress','fulfilled','paid','cancelled','rejected'
          )),
          cost_price NUMERIC(14,2),
          client_price NUMERIC(14,2),
          reward_type TEXT CHECK(reward_type IN ('percent','fixed') OR reward_type IS NULL),
          reward_value NUMERIC(14,2),
          reward_computed NUMERIC(14,2),
          priced_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          priced_at TIMESTAMPTZ,
          approved_at TIMESTAMPTZ,
          fulfilled_at TIMESTAMPTZ,
          paid_at TIMESTAMPTZ,
          cancel_reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_request_files (
          id SERIAL PRIMARY KEY,
          request_id INTEGER NOT NULL REFERENCES production_requests(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          mime TEXT,
          size_bytes INTEGER,
          data_base64 TEXT NOT NULL,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_request_price_history (
          id SERIAL PRIMARY KEY,
          request_id INTEGER NOT NULL REFERENCES production_requests(id) ON DELETE CASCADE,
          event TEXT NOT NULL CHECK(event IN (
            'initial_price','manager_counter','production_reprice','rejected','cancelled','approved','fulfilled','paid'
          )),
          cost_price NUMERIC(14,2),
          client_price NUMERIC(14,2),
          reward_type TEXT,
          reward_value NUMERIC(14,2),
          reward_computed NUMERIC(14,2),
          note TEXT,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Индексы: горячие запросы — по manager (мои заявки), по status (канбан).
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_requests_manager ON production_requests(manager_id, status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_requests_status ON production_requests(status, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_request_files_request ON production_request_files(request_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_request_history_request ON production_request_price_history(request_id, at DESC)`);

      // ===== Расширение просчётов (SCHEMA_VERSION 37) =====
      // 1. Новый статус awaiting_payment (approved → awaiting_payment → in_progress).
      //    Плюс поле production_deadline (утверждается производством после согласования).
      // 2. visibility на файлах: 'all' (видят все) | 'production_only' (только производство/admin).
      // 3. production_request_messages — чат внутри заявки.

      // Пересобираем CHECK-constraint на status (в PG нельзя изменить CHECK, только drop+add).
      await pool.query(`ALTER TABLE production_requests DROP CONSTRAINT IF EXISTS production_requests_status_check`);
      await pool.query(`
        ALTER TABLE production_requests ADD CONSTRAINT production_requests_status_check
        CHECK(status IN (
          'draft','awaiting_cost','priced','negotiating','approved','awaiting_payment',
          'in_progress','fulfilled','paid','cancelled','rejected'
        ))
      `);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS production_deadline TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS deadline_set_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS deadline_set_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS payment_marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);

      // history: расширяем список событий.
      await pool.query(`ALTER TABLE production_request_price_history DROP CONSTRAINT IF EXISTS production_request_price_history_event_check`);
      await pool.query(`
        ALTER TABLE production_request_price_history ADD CONSTRAINT production_request_price_history_event_check
        CHECK(event IN (
          'initial_price','manager_counter','production_reprice','rejected','cancelled',
          'approved','deadline_set','payment_received','started','fulfilled','paid'
        ))
      `);

      // Файлы: visibility.
      await pool.query(`ALTER TABLE production_request_files ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'all'`);
      await pool.query(`ALTER TABLE production_request_files DROP CONSTRAINT IF EXISTS production_request_files_visibility_check`);
      await pool.query(`
        ALTER TABLE production_request_files ADD CONSTRAINT production_request_files_visibility_check
        CHECK(visibility IN ('all','production_only'))
      `);

      // Чат в заявке. Автор — пользователь; text — сообщение; kind — тип
      // ('message' — обычное, 'system' — системное про смену статуса, автогенерируемое).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS production_request_messages (
          id SERIAL PRIMARY KEY,
          request_id INTEGER NOT NULL REFERENCES production_requests(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          text TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','system')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_request_messages_request ON production_request_messages(request_id, created_at ASC)`);

      // Дополнительный индекс на updated_at для быстрого сортированного списка.
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_requests_updated ON production_requests(updated_at DESC)`);

      // ===== Файлы, прикреплённые к сообщениям чата (SCHEMA_VERSION 38) =====
      // Обычные файлы заявки (visibility='all'), но связанные с конкретным
      // сообщением чата. В общем списке файлов фильтруются (не дублируются).
      await pool.query(`ALTER TABLE production_request_files ADD COLUMN IF NOT EXISTS chat_message_id INTEGER REFERENCES production_request_messages(id) ON DELETE SET NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_prod_request_files_chat_msg ON production_request_files(chat_message_id) WHERE chat_message_id IS NOT NULL`);

      // ===== Разделение сроков: сдача клиенту vs работа производства (SCHEMA_VERSION 39) =====
      // production_deadline уже был — это дата сдачи клиенту. Добавляем плановый
      // период работ производства: work_start_date и work_end_date (DATE, без времени).
      // work_start_date ≤ work_end_date ≤ production_deadline (валидируется в API).
      // Календарь рисует полосу по работе (не по всему периоду ожидания клиента).
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS work_start_date DATE`);
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS work_end_date DATE`);
      // Оценка от менеджера: сколько дней ориентировочно нужно на изготовление.
      // Показывается начальнику производства при распределении в календаре.
      await pool.query(`ALTER TABLE production_requests ADD COLUMN IF NOT EXISTS estimated_work_days INTEGER`);

      // ===== Логирование печати этикеток (SCHEMA_VERSION 41) =====
      // Раньше «Отгрузить всех» отправляло в shipped ВСЕХ, даже тех, для кого
      // этикетка не печаталась (пустой shipment_qr → пропуск в labels-pdf,
      // но статус всё равно менялся). Теперь /labels.pdf проставляет
      // label_printed_at ТОЛЬКО тем, для кого страница реально была в PDF
      // (был shipment_qr). Склад может фильтровать «reserved без напечатанной
      // этикетки» и физически найти пропуски.
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_printed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS label_print_count INTEGER NOT NULL DEFAULT 0`);
      // Индекс для фильтра «reserved без напечатанной этикетки».
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status_no_label ON orders(status) WHERE status = 'reserved' AND label_printed_at IS NULL`);

      // Маркер успешно прогнанных миграций — следующие холодные старты пропустят DDL.
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('schema_version', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(SCHEMA_VERSION)],
      );
      globalThis.__crmInitialized = true;
      return;
    } catch (e) {
      lastErr = e;
      const transient = isTransientDbError(e);
      // eslint-disable-next-line no-console
      console.error(
        `[db-init] attempt ${attempt}/${MAX_ATTEMPTS} failed (${transient ? 'transient' : 'fatal'}):`,
        e?.code, e?.message,
      );
      try { await globalThis.__crmPool?.end(); } catch { /* ignore */ }
      globalThis.__crmPool = null;
      // Не-транзиентные (auth, protocol) не ретраим — бесполезно.
      if (!transient) break;
      const delay = BACKOFF_MS[attempt - 1];
      if (delay == null) break; // последняя попытка — не ждём
      await new Promise((r) => setTimeout(r, delay));
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
