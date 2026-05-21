# CRM

Стандартная CRM-система с REST API и веб-интерфейсом: контакты, компании, лиды, сделки с воронкой продаж, задачи, заметки. Бэкенд — Node.js + Express + PostgreSQL. Развёртывается на Vercel (serverless) с Supabase в качестве базы, либо на собственном сервере.

## Возможности

- **Аутентификация** — JWT, роли `admin` / `manager` / `sales`.
- **Компании** — клиенты с отраслью, размером, выручкой, ответственным.
- **Контакты** — люди, привязанные к компаниям.
- **Лиды** — входящие потенциальные клиенты с источником и статусом (`new` → `contacted` → `qualified` / `unqualified` / `converted`). Конвертация лида в контакт + сделку + компанию одним вызовом.
- **Сделки (воронка продаж)** — стадии `new` → `qualified` → `proposal` → `negotiation` → `won` / `lost`, сумма, валюта, вероятность, ожидаемая дата закрытия. Эндпоинты «Выиграть»/«Проиграть» и сводный отчёт по воронке.
- **Задачи** — звонки, письма, встречи, задачи. Привязываются к любой сущности. Фильтры «в работе» / «просрочено».
- **Заметки** — свободный текст, прикрепляется к любой сущности.
- **Дашборд** — суммы воронки, взвешенная воронка, конверсия, задачи в работе / просрочено, распределение лидов и сделок.
- На каждом списке: поиск, фильтры, пагинация, сортировка.
- **Веб-UI** на чистом JS (без билд-степа) для всех CRUD-операций и канбан-доски воронки.

## Стек

- **Бэкенд:** Node.js 20+ / Express / `pg` / `bcryptjs` / `jsonwebtoken` / `zod`
- **База:** PostgreSQL (Supabase для облака, локальный Postgres для разработки)
- **Фронт:** vanilla JS + ES-модули, один CSS-файл, никаких сборок
- **Деплой:** Vercel (serverless functions) либо свой сервер через `node src/server.js`

---

## 🚀 Быстрый деплой на Vercel + Supabase

### 1. Создайте проект в Supabase

1. Откройте https://supabase.com → New project
2. После создания, в боковом меню: **Project Settings → Database → Connection string**
3. Выберите режим **Transaction** (это пулер на порту 6543, нужно для serverless)
4. Скопируйте строку вида:
   ```
   postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
   ```

> Используйте именно **Transaction pooler** (port 6543), не Direct connection (5432). Прямое соединение для serverless не подходит — Vercel создаёт много инстансов.

### 2. Задеплойте на Vercel

#### Через сайт Vercel

1. https://vercel.com/new → Import Git Repository
2. Выберите репозиторий `fayr89/CRM` и ветку `claude/build-crm-system-JzCP9`
3. Framework Preset: **Other**
4. Перед нажатием Deploy откройте Environment Variables и добавьте:

| Переменная       | Значение                                              |
|------------------|-------------------------------------------------------|
| `DATABASE_URL`   | Строка подключения из Supabase (см. шаг 1)            |
| `JWT_SECRET`     | Длинная случайная строка (например, `openssl rand -hex 32`) |
| `ADMIN_EMAIL`    | Email будущего админа                                 |
| `ADMIN_PASSWORD` | Сложный пароль (≥ 6 символов)                         |
| `ADMIN_NAME`     | Имя админа (необязательно)                            |
| `NODE_ENV`       | `production`                                          |

5. Нажмите Deploy.

#### Через CLI

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add ADMIN_EMAIL
vercel env add ADMIN_PASSWORD
vercel env add NODE_ENV         # значение: production
vercel --prod
```

### 3. Готово

- Откройте URL, который вернул Vercel (например `https://crm-xxx.vercel.app`)
- Войдите: `ADMIN_EMAIL` / `ADMIN_PASSWORD` из шага 2
- Схема в Supabase создастся автоматически при первом запросе

### Заполнить демо-данными (необязательно)

Локально, указав `DATABASE_URL` от Supabase:

```bash
DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres' \
  npm run seed
```

---

## 🛠 Локальная разработка

### Вариант 1: локальный PostgreSQL

```bash
# Создать пользователя и базу
sudo -u postgres psql -c "CREATE USER crm WITH PASSWORD 'crmpass';"
sudo -u postgres psql -c "CREATE DATABASE crmdb OWNER crm;"

# Установка
npm install
cp .env.example .env
# Поправить DATABASE_URL в .env, например:
# DATABASE_URL=postgres://crm:crmpass@localhost:5432/crmdb

npm run seed    # необязательно: заполнить демо-данными
npm start       # http://localhost:3000
```

### Вариант 2: подключиться к удалённой Supabase

```bash
npm install
cp .env.example .env
# В .env вставить строку подключения от Supabase
npm start
```

### Тесты

```bash
TEST_DATABASE_URL=postgres://crm:crmpass@localhost:5432/crmdb npm test
```

Тесты используют отдельную БД (или ту же, но очищают её). Без `TEST_DATABASE_URL` тесты пропускаются.

---

## 🖥 Свой сервер (после Vercel)

Для миграции с Vercel на свой VPS:

```bash
# На сервере
git clone https://github.com/fayr89/CRM.git
cd CRM
git checkout claude/build-crm-system-JzCP9
npm install --production
cp .env.example .env
nano .env   # вписать DATABASE_URL (можно оставить Supabase), JWT_SECRET, ADMIN_*

# Запустить через systemd / pm2 / docker
node src/server.js
```

Простейший systemd-сервис (`/etc/systemd/system/crm.service`):

```ini
[Unit]
Description=CRM
After=network.target

[Service]
WorkingDirectory=/opt/crm
ExecStart=/usr/bin/node src/server.js
EnvironmentFile=/opt/crm/.env
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now crm
```

Перед сервисом обычно ставят nginx как reverse proxy на порт 3000.

---

## 📡 API

Все эндпоинты кроме `/health`, `/api`, `/api/auth/login`, `/api/auth/register` требуют заголовок `Authorization: Bearer <token>`.

| Раздел       | Эндпоинты                                                                 |
|--------------|---------------------------------------------------------------------------|
| Авторизация  | `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`     |
| Пользователи | `GET/POST /api/users`, `GET/PATCH/DELETE /api/users/:id`                  |
| Компании     | `GET/POST /api/companies`, `GET/PATCH/DELETE /api/companies/:id`, `GET /api/companies/:id/contacts`, `GET /api/companies/:id/deals` |
| Контакты     | `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`            |
| Лиды         | `GET/POST /api/leads`, `GET/PATCH/DELETE /api/leads/:id`, `POST /api/leads/:id/convert` |
| Сделки       | `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/:id`, `POST /api/deals/:id/win`, `POST /api/deals/:id/lose`, `GET /api/deals/pipeline` |
| Задачи       | `GET/POST /api/activities`, `GET/PATCH/DELETE /api/activities/:id`, `POST /api/activities/:id/complete` |
| Заметки      | `GET/POST /api/notes`, `GET/PATCH/DELETE /api/notes/:id`                  |
| Дашборд      | `GET /api/dashboard/stats`, `GET /api/dashboard/recent`                   |

### Параметры списков

- `page` (по умолчанию 1), `limit` (по умолчанию 25, максимум 200)
- `sort` — название колонки, префикс `-` для убывания (`sort=-created_at`)
- `search` — подстрока для поиска
- Специфичные фильтры: `?stage=proposal`, `?status=qualified`, `?owner_id=3` и т.д.

Формат ответа:

```json
{
  "data": [ /* записи */ ],
  "pagination": { "page": 1, "limit": 25, "total": 137, "total_pages": 6 }
}
```

### Примеры

```bash
# Логин
TOKEN=$(curl -s -X POST https://crm.example/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .token)

# Создать сделку
curl -X POST https://crm.example/api/deals \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title": "Расширение Ромашки",
    "amount": 500000,
    "currency": "RUB",
    "stage": "qualified",
    "expected_close_date": "2026-09-30",
    "company_id": 1
  }'

# Закрыть как выигранную
curl -X POST https://crm.example/api/deals/12/win -H "Authorization: Bearer $TOKEN"

# Сводка по воронке
curl https://crm.example/api/deals/pipeline -H "Authorization: Bearer $TOKEN"

# Конвертировать лида
curl -X POST https://crm.example/api/leads/7/convert \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"create_deal":true,"deal_stage":"qualified"}'
```

---

## 📦 Схема данных

```
users        (id, email, password_hash, name, role, active)
companies    (id, name, industry, website, phone, email, address, size, annual_revenue, description, owner_id)
contacts     (id, first_name, last_name, email, phone, position, company_id, owner_id, notes)
leads        (id, first_name, last_name, email, phone, company_name, position, source, status,
              estimated_value, description, owner_id, converted_*)
deals        (id, title, amount, currency, stage, probability, expected_close_date, closed_at,
              lost_reason, contact_id, company_id, owner_id, description)
activities   (id, type, subject, description, due_date, completed_at,
              related_to_type, related_to_id, owner_id)
notes        (id, content, related_to_type, related_to_id, author_id)
```

Схема создаётся автоматически при первом запросе (если таблиц нет — будут созданы).

## ⚙️ Переменные окружения

| Переменная       | По умолчанию              | Описание                                |
|------------------|---------------------------|-----------------------------------------|
| `PORT`           | `3000`                    | HTTP-порт (для локального запуска)      |
| `DATABASE_URL`   | _обязательно_             | Строка подключения к Postgres           |
| `JWT_SECRET`     | _нужно поменять_          | Секрет подписи JWT                      |
| `JWT_EXPIRES_IN` | `7d`                      | Срок жизни токена                       |
| `ADMIN_EMAIL`    | `admin@example.com`       | Email админа по умолчанию               |
| `ADMIN_PASSWORD` | `admin123`                | Пароль админа по умолчанию              |
| `ADMIN_NAME`     | `Администратор`           | Отображаемое имя админа                 |
| `NODE_ENV`       | `development`             | На проде ставить `production` (включит SSL для БД) |

Админ создаётся только если в таблице `users` пусто. Для смены пароля существующего админа — через UI («Пользователи» → редактировать) или напрямую в БД.
