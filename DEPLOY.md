# Деплой на Vercel

Проект состоит из двух частей, которые деплоятся как **два отдельных Vercel-проекта** из этого же репозитория, но из разных веток.

| Проект | Ветка | Стек | Что делает |
|---|---|---|---|
| **crm-backend** | `claude/build-crm-system-JzCP9` | Node.js + Express + Postgres | REST API, авторизация, БД |
| **crm-frontend** | `v0/crm-direct-sales-b863f241` | Next.js 16 + React 19 + Tailwind 4 | UI с 16 страницами |

---

## Шаг 1. База данных (Supabase)

1. Зарегистрируйся на [supabase.com](https://supabase.com), создай новый проект.
2. **Project Settings → Database → Connection string → Transaction mode (порт 6543)** — скопируй строку. Должна выглядеть так:
   ```
   postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
   ```
3. **Важно:** именно Transaction pooler (6543), не Direct (5432). Для serverless нужен пулер.

---

## Шаг 2. Бэкенд → `crm-backend.vercel.app`

1. [vercel.com/new](https://vercel.com/new) → Import → выбери репозиторий **`fayr89/CRM`**.
2. **Production Branch:** `claude/build-crm-system-JzCP9`.
3. **Framework Preset:** `Other` (Vercel сам поймёт что это Node.js функция в `api/`).
4. **Environment Variables** (Settings → Environment Variables):
   | Переменная | Значение |
   |---|---|
   | `DATABASE_URL` | строка подключения из Шаг 1 |
   | `JWT_SECRET` | случайная строка ≥ 32 символов (например `openssl rand -hex 32`) |
   | `ADMIN_EMAIL` | твой email будущего админа |
   | `ADMIN_PASSWORD` | пароль администратора (≥ 8 символов) |
   | `ADMIN_NAME` | имя админа (необязательно) |
   | `NODE_ENV` | `production` |
5. Жми **Deploy**. Подожди ~1 мин.
6. После деплоя проверь: `https://crm-backend-xxx.vercel.app/health` должен вернуть `{"status":"ok",...}`.
7. **Войти можно по** `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Заполнить демо-данными (опционально)

В Vercel пока нет встроенного CRON, но можно один раз вручную:

```bash
# Локально, с DATABASE_URL из шага 1
git clone -b claude/build-crm-system-JzCP9 https://github.com/fayr89/CRM.git crm-backend
cd crm-backend
npm install
DATABASE_URL='postgres://...' \
  ADMIN_EMAIL=your@email.com \
  ADMIN_PASSWORD=your-pass \
  JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed
```

Должен вывести в консоль API-токен для тестов внешних интеграций.

---

## Шаг 3. Фронтенд → `crm.vercel.app`

1. [vercel.com/new](https://vercel.com/new) → Import → выбери репозиторий **`fayr89/CRM`** ещё раз (можно по второму проекту).
2. **Production Branch:** `v0/crm-direct-sales-b863f241`.
3. **Framework Preset:** `Next.js` (определится автоматически).
4. **Environment Variables**:
   | Переменная | Значение |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | URL бэкенда из Шага 2, например `https://crm-backend-xxx.vercel.app` |

   Если оставить пустым — фронт работает на mock-данных (видны демо-сделки, заказы, товары). Это нормально для первого знакомства.
5. Жми **Deploy**.
6. Через ~2 мин открой `https://crm-xxx.vercel.app` — должна открыться страница входа.

---

## Шаг 4. Логотип

В `public/logo.svg` сейчас лежит плейсхолдер (синий квадрат с буквой). Замени файл своим SVG/PNG — он используется в:
- Sidebar (32×32, верх левой панели)
- Login и Accept страницы (~120×48)
- Mobile header (28×28)

Просто залей файл в репозиторий по пути `public/logo.svg`, Vercel пересоберёт автоматически.

---

## Шаг 5. (Опционально) Свой домен

Vercel → Project Settings → Domains → Add Domain → введи свой домен → следуй инструкциям по DNS.

Рекомендация:
- `crm.твой-домен.com` → фронтенд
- `api.твой-домен.com` → бэкенд

Если поменяешь домен бэкенда — не забудь обновить `NEXT_PUBLIC_API_URL` во фронтенде и редеплоить.

---

## Что между фронтом и бэком сейчас

**Фронт по умолчанию работает на mock-данных.** UI кликабельный, drag-and-drop работает, формы сохраняют в React-стейте. Но ничего не уходит на сервер.

**Чтобы подключить реальный API:** надо заменить импорты `from "@/lib/mock-data"` на fetch-вызовы к `${NEXT_PUBLIC_API_URL}/api/...`. Это отдельная задача после деплоя.

---

## Локальный запуск перед деплоем

### Бэкенд

```bash
git checkout claude/build-crm-system-JzCP9
npm install
cp .env.example .env  # отредактируй DATABASE_URL, JWT_SECRET, ADMIN_*
npm run dev
# → http://localhost:3000
```

### Фронтенд

```bash
git checkout v0/crm-direct-sales-b863f241
npm install
# (опционально) cp .env.local.example .env.local
npm run dev
# → http://localhost:3000
```
