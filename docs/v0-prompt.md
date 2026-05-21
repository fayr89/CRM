# ТЗ для v0.dev — CRM «Прямые продажи» (полный фронтенд)

> Скопируй весь этот документ как один промпт в v0.dev. На выходе — Next.js-проект с UI всех экранов, готовый к интеграции с нашим бэкендом. После генерации скачай ZIP и пришли мне.

---

## 1. О продукте

Это **CRM-система для прямых продаж через маркетплейсы и собственные сайты**. Используется командой из 4 ролей: **админ**, **менеджер**, **продажник (sales)**, **склад (warehouse)**. Основные сценарии:

- Менеджер ведёт сделки в воронке (drag-and-drop) и работает с лидами/контактами/компаниями.
- Заказы прилетают с Wildberries / Ozon / Avito / Яндекс.Маркета / собственных лендингов и Telegram-ботов через API. Менеджер видит их в табличной форме или на канбане.
- Склад резервирует и отгружает заказы (тоже через drag-and-drop по статусам).
- Каталог товаров с себестоимостью, картинками и прайсами по площадкам — цена в заказе подставляется автоматически.
- Менеджер ведёт кассу, админ подтверждает платежи.
- Админ управляет пользователями, приглашениями, API-токенами и вебхуками для интеграции с внешними системами.

**Tone:** дружелюбный, деловой, без корпоративной казёнщины. Должно быть приятно пользоваться каждый день.

**Язык интерфейса:** русский. Все тексты в этом ТЗ — финальные тексты UI.

---

## 2. Технический стек и структура

Сгенерируй Next.js 15 проект (App Router, TypeScript, Tailwind v4, **shadcn/ui**, **lucide-react** для иконок). 

- Все компоненты — **Server Components по умолчанию**, `'use client'` только где нужна интерактивность (формы, dnd, autocomplete).
- Drag-and-drop — `@dnd-kit/core`.
- Состояние модалок и тостов — через `sonner` или встроенный `useState`.
- Маршрутизация — App Router, страницы под путями ниже.
- Mock-данные положи в `lib/mock-data.ts` и используй их во всех экранах, чтобы я мог нажимать на ссылки и листать.

### Маршруты

```
/                  — редирект на /dashboard
/login             — экран входа
/accept            — приём приглашения (token из query)
/dashboard         — главная
/pipeline          — воронка сделок (kanban с DnD)
/deals             — таблица сделок
/leads             — таблица лидов
/contacts          — таблица контактов
/companies         — таблица компаний
/activities        — таблица задач
/orders            — заказы (table или kanban)
/orders/new        — модалка/страница создания заказа
/products          — каталог товаров (сетка)
/cashbox           — касса менеджера
/users             — список пользователей (admin/manager)
/invitations       — приглашения (admin/manager)
/integrations      — токены, вебхуки, доки (admin)
```

### Файловая структура (ориентир)

```
app/
  layout.tsx
  (dashboard)/layout.tsx        — shell для авторизованных экранов
  (dashboard)/dashboard/page.tsx
  (dashboard)/pipeline/page.tsx
  (dashboard)/deals/page.tsx
  ... (по одному файлу на маршрут)
  login/page.tsx
  accept/page.tsx
components/
  shell/              — Sidebar, SearchCommand, NotifBell, UserBlock
  dashboard/          — GreetingCard, TodayCard, StatCard, MiniBars
  pipeline/           — KanbanBoard, DealCard, StageColumn
  orders/             — OrdersKanban, OrdersTable, OrderForm, QuickAdd, ItemsEditor, ProductPicker
  products/           — ProductGrid, ProductCard, ProductForm, PricesEditor, MoyskladImport
  cashbox/            — BalanceCard, PaymentsTable
  integrations/       — TokensTable, WebhooksTable, IntegrationsDocs, CreateTokenModal
  common/             — EmptyState, HelpBanner, PageHeader, StatusBadge, Avatar
  ui/                 — shadcn компоненты
lib/
  types.ts
  mock-data.ts
  utils.ts
public/
  logo.svg            — ПЛЕЙСХОЛДЕР, я заменю на свой логотип
```

---

## 3. Дизайн-система

### Цвета (CSS-переменные в `globals.css`)

```
--background: #f4f5f7
--surface: #ffffff
--border: #e3e6eb
--text: #1f2328
--text-muted: #6b7280
--primary: #2563eb              royal blue
--primary-hover: #1d4ed8
--danger: #dc2626
--success: #16a34a
--warning: #d97706
--sidebar-bg: #111827           тёмно-синий, почти чёрный
--sidebar-bg-hover: #1f2937
--sidebar-text: #d1d5db
--sidebar-text-active: #ffffff
--shadow-sm: 0 1px 3px rgba(0,0,0,0.06)
--shadow-md: 0 4px 12px rgba(0,0,0,0.08)
--shadow-lg: 0 8px 24px rgba(0,0,0,0.12)
--radius-sm: 4px
--radius: 6px
--radius-lg: 8px
```

### Типографика

Inter / SF Pro / system stack. Размеры:
- **22px / 700** — page-title
- **16px / 700** — section-title
- **14px / 500** — body
- **13px / 400** — table cells, controls
- **12px / 600** — labels, captions
- **11px / 700 / uppercase 0.4px** — stat labels, kbd
- **10px / 700 / uppercase** — badges

### Бэйджи статусов (важно — общий компонент)

`<StatusBadge value="new" />` рендерит pill с уникальными цветами для каждого значения:

| Категория | Значения и цвета |
|---|---|
| Лиды (status) | new=голубой, contacted=индиго, qualified=индиго-темнее, unqualified=красный, converted=зелёный |
| Сделки (stage) | new=голубой, qualified=индиго, proposal=жёлтый, negotiation=оранжевый, won=зелёный, lost=красный |
| Заказы (status) | new=голубой, reserved=жёлтый, shipped=индиго, completed=зелёный, cancelled=серый |
| Платежи (status) | pending=жёлтый, confirmed=зелёный, rejected=красный |

Палитра пар (bg + text): голубой `#dbeafe / #1e40af`, индиго `#e0e7ff / #3730a3`, жёлтый `#fef3c7 / #92400e`, оранжевый `#fed7aa / #9a3412`, зелёный `#d1fae5 / #065f46`, красный `#fee2e2 / #991b1b`, серый `#e5e7eb / #4b5563`.

---

## 4. Типы данных (положи в `lib/types.ts`)

```ts
export type Role = 'admin' | 'manager' | 'sales' | 'warehouse';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  managerId?: number | null;
  active: boolean;
}

export interface Company {
  id: number;
  name: string;
  industry?: string;
  size?: 'small' | 'medium' | 'large' | 'enterprise';
  annualRevenue?: number;
  ownerId?: number;
  createdAt: string;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  companyId?: number;
  ownerId?: number;
}

export interface Lead {
  id: number;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source: 'website' | 'referral' | 'cold_call' | 'social' | 'event' | 'advertisement' | 'other';
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';
  estimatedValue?: number;
  ownerId?: number;
}

export interface Deal {
  id: number;
  title: string;
  amount: number;
  currency: string;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  probability: number;
  expectedCloseDate?: string;
  companyId?: number;
  companyName?: string;
  contactId?: number;
  ownerId?: number;
}

export interface Activity {
  id: number;
  type: 'call' | 'email' | 'meeting' | 'task';
  subject: string;
  dueDate?: string;
  completedAt?: string;
  relatedToType?: 'contact' | 'company' | 'lead' | 'deal';
  relatedToId?: number;
  ownerId?: number;
}

export interface Product {
  id: number;
  sku?: string;
  name: string;
  imageUrl?: string;
  costPrice: number;
  unit: string;
  description?: string;
  externalSource?: 'moysklad';
  active: boolean;
  prices?: { marketplace: string; price: number }[];
  priceCount?: number;
  marketplacePrice?: number | null;  // только в /for-marketplace и /popular
  recentUsage?: number;              // только в /popular
}

export type Marketplace = 'Wildberries' | 'Ozon' | 'Яндекс.Маркет' | 'Avito' | 'Другое';

export interface OrderItem {
  id: number;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productId?: number;
  imageUrl?: string;
  catalogPrice?: number | null;
}

export interface Order {
  id: number;
  referenceNumber?: string;
  marketplace?: Marketplace;
  clientClassification?: string;
  clientName?: string;
  totalAmount: number;
  currency: string;
  status: 'new' | 'reserved' | 'shipped' | 'completed' | 'cancelled';
  managerId?: number;
  managerName?: string;
  warehouseUserName?: string;
  notes?: string;
  reservedAt?: string;
  shippedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  items?: OrderItem[];
  itemsCount?: number;
  previewImage?: string | null;
}

export interface Payment {
  id: number;
  managerId: number;
  managerName?: string;
  orderId?: number;
  amount: number;
  currency: string;
  method?: 'cash' | 'card' | 'bank_transfer' | 'other';
  reference?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmedAt?: string;
  confirmedBy?: number;
  rejectionReason?: string;
  createdAt: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface ApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  scopes: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string;
  active: boolean;
  deliveriesCount: number;
  lastDeliveryAt?: string;
  lastStatusCode?: number;
}
```

---

## 5. Mock-данные (положи в `lib/mock-data.ts`)

Сгенерируй реалистичные русскоязычные демо-данные:
- 4 пользователя (admin@example.com, manager@example.com — Мария Иванова, sales@example.com — Алиса Петрова, warehouse@example.com — Кирилл Сидоров)
- 5 компаний (ООО «Глобал», ИП Сидоров, ООО «ТехноПром», ...)
- 8 контактов с разными должностями
- 6 лидов в разных статусах
- 10 сделок на разных стадиях (см. раздел Воронка)
- 12 задач (часть просрочена, часть на будущее)
- **15 товаров с реальными картинками с Unsplash** (поиск unsplash.com по теме: одежда, посуда, электроника, автозапчасти) с разными прайсами по площадкам
- 8 заказов в статусах new (3), reserved (2), shipped (1), completed (1), cancelled (1)
- 6 платежей (2 pending, 3 confirmed, 1 rejected)
- 12 уведомлений
- 2 API-токена, 1 webhook

Экспортируй также утилиты для формирования аватаров по имени (инициалы + детерминированный цвет).

---

## 6. Layout shell — `app/(dashboard)/layout.tsx`

Двухколоночный layout с фиксированным сайдбаром 220px слева и скроллящимся контентом справа.

### Сайдбар (тёмная тема `var(--sidebar-bg)`)

Вертикальный flex:

1. **Бренд сверху** (20px padding): место под логотип — `<img src="/logo.svg" />` 32px высотой + текст «CRM» рядом, на отдельной строке снизу. Логотип — плейсхолдер, я подложу свой файл.

2. **Кнопка глобального поиска** (флекс-строка, hover светлеет):
   - Слева: `🔍 Поиск`
   - Справа: `<Kbd>Ctrl K</Kbd>` бэйдж
   - Открывает CommandPalette (см. ниже)

3. **Колокольчик уведомлений**:
   - Слева: `🔔 Уведомления`
   - Справа: красный круглый счётчик `12` если есть непрочитанные (`var(--danger)` bg)
   - Открывает дропдаун с уведомлениями

4. **Навигация** (flex:1, скроллится при необходимости). Активный пункт — синяя полоска слева 3px + чуть светлее bg:
   - 📊 Дашборд
   - 📈 Воронка
   - 💼 Сделки
   - 🌱 Лиды
   - 👥 Контакты
   - 🏢 Компании
   - 📋 Задачи
   - 📦 Прямые продажи
   - 🛍️ Каталог
   - 💰 Касса
   - ━━━ separator ━━━
   - 🧑 Пользователи (admin / manager)
   - ✉️ Приглашения (admin / manager)
   - 🔌 Интеграции (admin)

5. **User-блок снизу** (border-top):
   - Avatar (инициалы на цветном bg)
   - Имя bold + email muted + роль («Менеджер»)
   - Кнопка «Выйти» (outline)

### Топбар: не нужен — всё в сайдбаре

### Toast-контейнер: top-right, использует `sonner`

### Modal-root: backdrop `rgba(0,0,0,0.4)`, центр, max-width зависит от модалки

---

## 7. Командная палитра поиска (Ctrl+K)

`<CommandPalette />` — модалка с большим input сверху, под ней группированный список:

- Триггерится по Ctrl+K / Cmd+K
- Большой поисковый input (16px, autofocus), placeholder «Поиск по контактам, компаниям, лидам, сделкам, заказам…»
- Подсказка: «Esc — закрыть · ↑↓ — навигация · Enter — открыть»
- Под капотом — `cmdk` или ручная реализация
- Группы результатов с заголовками: «🌱 Лиды», «👥 Контакты», «🏢 Компании», «💼 Сделки», «📦 Заказы»
- Каждая строка результата: основная инфа (имя/название), вторичная (email/телефон/сумма)
- Hover/highlighted: bg `#eff6ff`
- Empty state: «Введите минимум 2 символа…» или «Ничего не найдено»

---

## 8. Дропдаун уведомлений

Открывается по клику на колокольчик. Floating-панель ~340px шириной, прикреплена справа от сайдбара:

- **Хедер**: «Уведомления» bold + ссылка «Прочитать все» справа (если есть непрочитанные)
- **Список** (scroll, max-height 480px):
  - Каждая запись: title bold, body muted, time-ago серое 11px
  - Непрочитанные: левая синяя граница 3px + bg `#eff6ff`
  - Клик → переход по link и закрытие
- **Empty state**: «Уведомлений нет»

Toast при появлении нового уведомления (через sonner): зелёный успех / красный ошибка / нейтральный info.

---

## 9. Страница `/login`

Центрированная карточка ~380px:
- Логотип сверху по центру
- Заголовок «Вход в CRM»
- Поля: Email + Пароль
- Большая кнопка «Войти» (full width)
- Подсказка снизу: «Войти можно только по приглашению от менеджера или администратора.»
- Mock: Email `admin@example.com` пред-заполнен

Cвой собственный layout без сайдбара.

---

## 10. Страница `/dashboard`

### Карточка приветствия (gradient blue, full-width)

- Фон `linear-gradient(135deg, #1e3a8a, #2563eb)`, белый текст
- Большой заголовок 22px: «Доброе утро, Мария!» (адаптируется к времени суток — ночь / утро / день / вечер) и имя пользователя
- Сабтекст 13px: совет под роль
  - admin: «Вы видите все данные. Раздел «Интеграции» позволяет подключить внешние сайты и Telegram-боты.»
  - manager: «Вы видите данные своих подчинённых. Создавайте сделки и распределяйте задачи.»
  - sales: «Перетащите сделку на воронке — стадия поменяется.»
  - warehouse: «Откройте «Прямые продажи», переключитесь на канбан и тащите заказы между стадиями.»

### Карточка «Сегодня»

Простая белая карточка с заголовком «Сегодня» (uppercase, 14px, muted) и списком:
- ⚠️ 3 просроченные задачи (если есть)
- 📋 7 задач в работе
- 💰 Ожидаемая выручка: 245 000 ₽
- ✨ Срочных дел нет. Хорошо поработать сегодня! (если всё пусто)

### Stat-карточки 4 в ряд (повторить 2 раза)

Первый ряд: Компании, Контакты, Лиды, Сделки — каждая с uppercase-label сверху (11px, muted), big number 24px, optional sub (12px muted).

Второй ряд: «Сумма воронки», «Взвешенная воронка», «Конверсия» (3/5 = 60%), «Задачи» (с overdue).

### Горизонтальные бары

Две карточки одинаковой ширины: «Лиды по статусу» и «Сделки по стадии». Внутри — список строк `name | bar (заполненный primary) | count`. Высота бара 8px, скруглённый.

---

## 11. Страница `/pipeline` — воронка сделок (kanban с drag-and-drop)

### Заголовок
PageHeader: «Воронка продаж» + кнопка справа «Новая сделка».

### Help-баннер
Жёлтый баннер: «💡 Перетаскивайте карточки между колонками, чтобы менять стадию сделки. Клик по карточке — открыть детали.»

### Сама доска

6 колонок в горизонтальной сетке: Новая / Квалифицирована / Предложение / Переговоры / Выиграна / Проиграна.

- Шапка колонки (font-size 12px, font-weight 700): название слева + `count · total_amount` справа
- Колонка bg `#f1f3f5`, min-height 200px, скруглённая
- Drop-target подсветка: дашед outline `var(--primary)` + bg `#e0f2fe`
- Карточка сделки: белая, border, padding 10px:
  - **Title** (font-weight 600, 13px)
  - **Meta строка 1**: amount + ' · ' + probability%
  - **Meta строка 2**: company name
  - **Meta строка 3**: '📅 ' + expected_close_date
  - Hover: border `var(--primary)`
  - `draggable={true}`, при перетаскивании opacity 0.4, transform scale(0.97)
  - При drop в «Выиграна» — конфетти-анимация (используй `canvas-confetti` или CSS-конфетти)
  - При drop в «Проиграна» — спросить причину промтом

### Снизу

Summary card: «Сумма воронки: X · Взвешенная: Y»

### Мобильный вид (≤640px)

Колонки в одну строку с horizontal scroll. Активная колонка занимает почти всю ширину, соседние видны на 20%.

---

## 12. Страница `/orders` — заказы

### Page header

«Прямые продажи (Avito)» + сабтайтл «Заказы из маркетплейсов и с собственных сайтов»

### Toolbar

Поиск + Status select + Marketplace select + spacer + **View toggle**:

```
[☰ Список] [▦ Канбан]
```

Активная кнопка primary. Состояние сохраняется в localStorage.

Справа от toggle: кнопка «Новый заказ» (primary).

### View «Список» — табличная

Колонки: № / Площадка / Внеш. № / Клиент / Сумма / Поз. / Статус (бэйдж) / Менеджер / Создан / Действия

Кнопки в Действия (зависят от роли и статуса):
- Склад/админ + new: «Резервировать»
- Склад/админ + reserved: «Отгрузить»
- Менеджер/админ + shipped: «Завершить»
- Любой с доступом + не closed: «Отменить» (с promt для причины)

Hover на строке: bg `#f9fafb`, cursor pointer (открывает детали).

Empty state: иконка 📦, заголовок «Заказов пока нет», описание зависит от роли.

### View «Канбан» с drag-and-drop

5 колонок: Новый / Зарезервирован / Отгружен / Завершён / Отменён.

**Help-баннер**:
- Для склада: «💡 Перетаскивайте заказы: «Новый» → «Зарезервирован» → «Отгружен». Клик откроет детали.»
- Для остальных: «💡 Перетащите отгруженный заказ в «Завершён», чтобы закрыть. Менеджер может отменить новый заказ.»

Карточка заказа:
- **Верхняя строка**: миниатюра первого товара 36x36 (или 📦 placeholder) + `#ID · client_name`
- Meta: `amount · marketplace`
- Опционально: `№ reference_number`
- `👤 manager_name`

Drag разрешён ТОЛЬКО для допустимых переходов:
- new → reserved (только склад/админ)
- reserved → shipped (только склад/админ)
- shipped → completed (любой с доступом)
- любой → cancelled

При недопустимом drop — toast «Нельзя перевести из X в Y».

### Мобильный

Канбан как горизонтальный snap-scroll по одной колонке. Таблица — карточки.

---

## 13. Модалка «Новый заказ» / «Редактировать заказ» — **главный фокус v0**

Открывается из `/orders` (или как отдельная страница `/orders/new`). Размер `max-width: 800px`.

### Верхняя секция — реквизиты заказа

2-колоночная сетка:

| Поле | Тип | Опции |
|---|---|---|
| Номер заказа (с площадки) | text | плейсхолдер «WB-123456» |
| Площадка | select | Wildberries / Ozon / Яндекс.Маркет / Avito / Другое |
| Классификация клиента | text | плейсхолдер «B2B / B2C / VIP / …» |
| Клиент | text | |
| Валюта | text(3) | width 80px |
| Заметки | textarea | |

### Секция «Позиции заказа»

Это самая важная и продуманная часть UI. Три слоя скорости:

#### Слой A — поле поиска с подсказками (autocomplete)

Серый бокс `bg: #f9fafb, padding: 12px`. Внутри сверху flex-строка:

```
[🔍 Начните вводить название или артикул…              ] [📦 Каталог]
```

- Search input занимает всю ширину, имеет иконку лупы слева
- По мере ввода (debounce 180ms) показывается **выпадающий список** прямо под полем (absolute, z-index: 50, shadow-lg):
  - До 8 предложений
  - Каждое: миниатюра 36x36 (или 📦), название (bold) + «Арт: XXX» (muted), справа цена для текущей площадки **bold primary** или «нет в прайсе» (amber/warning)
  - Hover/highlight: bg `#eff6ff`
- Управление с клавиатуры: ↑↓ навигация, Enter добавляет в позиции, Esc закрывает, blur с задержкой 150ms (чтобы клик успел сработать)
- При выборе: добавляется новая строка в таблицу позиций, поле очищается, фокус возвращается в input (для следующей позиции)
- «📦 Каталог» открывает полный пикер (модалка в модалке)

#### Слой B — полоса «⚡ Популярные за 30 дней»

Под autocomplete-боксом, в том же сером боксе:

Заголовок строкой:
```
⚡ ПОПУЛЯРНЫЕ ЗА 30 ДНЕЙ                    клик — добавить
```

Под ним — **горизонтально-скроллящаяся** строка из 20 карточек товаров:

- Каждая карточка: 120px wide, ~150px tall, белая, border, скруглённая
- Внутри: миниатюра 56x56 (или 📦) | название (2 строки clamp, 11px) | цена для площадки bold primary
- В правом верхнем углу — синий pill-бейдж «× 42» с количеством использований за период
- Hover: lift translateY(-1px), shadow, primary border
- Click → instant добавление в позиции с quantity=1

Scroll-bar тонкий, серый.

Если каталог пуст: empty-state «В каталоге пока нет товаров. Добавьте на странице «Каталог».»

#### Слой C — таблица позиций (под бокcом быстрого добавления)

Колонки:

| 50px thumb | SKU + 📦-button | Название | Кол-во | Цена | × |

- Каждая строка имеет миниатюру (40x40, объект-cover; placeholder с «—» если нет)
- Кнопка 📦 рядом с SKU — открывает полный пикер для замены товара
- Поле Кол-во — number, min 1, ширина 70px
- Поле Цена — number, ширина 100px
- Под полем Цена — **подсказка price-hint** (10px, line-height 1.2):
  - Если catalog_price задан и совпадает: «прайс: 1500 ₽» **зелёным** (success)
  - Если catalog_price задан и отличается: «📝 изменено · прайс: 1500 ₽» **amber** (warning), bold
  - Если catalog_price не задан: пусто
- × — кнопка удаления строки

Под таблицей:
- Сумма: «Итого: X ₽» right-aligned, bold, 14px
- Кнопка «+ Добавить пустую позицию» (вторичная) — для ad-hoc позиций не из каталога

### Поведение при смене площадки

Когда пользователь меняет marketplace в select:
1. Заново подтягивается список популярных товаров с ценами новой площадки
2. Для уже выбранных строк обновляется catalog_price reference (НО unit_price не трогаем — это даст подсветку «📝 изменено», если пользователь не хочет менять цену)

### Полный пикер товара (модалка-в-модалке)

Открывается из кнопки «📦 Каталог» или 📦 в строке.

- Заголовок «Выбор товара» + chip с активной площадкой (bg `#dbeafe`, color `#1e40af`)
- Внутри: search input на всю ширину
- Список с большими карточками (полная высота 50vh, scroll):
  - thumb 48x48 + name + sku + cost_price | marketplace_price справа
- Click на карточку → закрывает модалку и заполняет строку

### Footer модалки заказа

- Кнопка «Отмена» (вторичная)
- Кнопка «Создать» (primary) / «Сохранить» при редактировании

### Keyboard power-flow

Tab в поиск → ввод «фут» → ↓ Enter → футболка добавлена → продолжай печатать следующую → не отрывая рук от клавиатуры собрал заказ из 10 позиций.

---

## 14. Страница `/products` — каталог товаров

### Page header

«Каталог товаров» + сабтайтл «Себестоимость, картинки и прайсы по площадкам. Используется в форме заказа.»

### Help banner

«💡 Прайс по площадке = цена этого товара для конкретного маркетплейса/лендинга. При создании заказа подставится автоматически.»

### Toolbar

Поиск + spacer + «⬇ Импорт из МойСклад» (вторичная, admin only) + «Новый товар» (primary)

### Сетка карточек

`grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`, gap 14px.

Карточка товара (clickable, hover lift):
- **Image** сверху, 100% width, height 140px, object-cover, background `#f3f4f6`, скруглён сверху как карточка. Если нет — placeholder 📦 40px серый в центре
- **Name** bold, 14px, 2 строки clamp
- **SKU**: «Арт: XXX» (muted 11px) + опциональный bagde `moysklad` (indigo)
- **Cost** строкой: «Себестоимость» (muted) + сумма (bold)
- **Pricelists count**: «3 прайса» (primary) или «нет прайсов» (warning)
- Если `active === false`: в правом верхнем углу абсолютный бэйдж «Архив» (dark transparent)

### Модалка товара (создание/редактирование)

Большая (max-width: 800px), 2-колоночный grid:

| Поле | Тип |
|---|---|
| Название * | text full-width |
| Артикул (SKU) | text |
| Единица | text (по умолчанию «шт») |
| Себестоимость | number |
| Активен | checkbox + поясн. «Показывать в пикере заказов» |
| URL картинки | text full-width + live превью 120x120 ниже |
| Описание | textarea full-width |

При редактировании ниже — **секция «Прайсы по площадкам»**:

Светло-серый бокс. Внутри:
- Список существующих прайсов: `[Wildberries] [1 200 ₽] [Удалить]`
- Форма добавления: select площадки + number-input цены + кнопка «+ Добавить»

Если прайсов нет: «Прайсов пока нет. Добавьте цену для конкретной площадки ниже.»

### Модалка импорта МойСклад

Заголовок «Импорт из МойСклад». Внутри:
- Описание «Импорт подтянет каталог из МойСклад: название, артикул, себестоимость, картинку. Существующие товары обновятся.»
- Ссылка на доку МойСклад (где взять токен)
- Поле «Токен» (password input)
- Кнопка «Начать импорт»
- Под кнопкой — статус: «⏳ Импортируем…» → «✅ Готово: создано N, обновлено M, всего K»

---

## 15. Страница `/cashbox` — касса

### Большая gradient-карточка баланса

`linear-gradient(135deg, #2563eb, #1d4ed8)`, белый текст, padding 24px:
- Label «Баланс» 12px uppercase opacity 0.85
- Big value 32px bold: `28 000 ₽`
- Sub: «Подтверждено: 28 000 ₽ · На подтверждении: 1 350 ₽»

### Toolbar

Status filter + spacer + «Добавить платёж» (primary)

### Если admin — селектор менеджера

Сверху над балансом dropdown «Касса менеджера: Мария Иванова ▾» с переключателем.

### Таблица платежей

Колонки: Дата / Сумма / Метод (Наличные / Карта / Банк. перевод) / Номер транзакции / Привязан к заказу / Статус (бэйдж) / Действия

Действия (для admin при status=pending):
- «Подтвердить» (success outline)
- «Отклонить» (danger outline, с promt для причины)

### Модалка «Добавить платёж»

- Сумма * (number)
- Метод (select: Наличные / Карта / Банк. перевод / Другое)
- Номер транзакции (text)
- Привязать к заказу (number, ID, опционально)
- Заметки (textarea)

---

## 16. Страница `/integrations` (admin only)

Три секции через Tabs или вертикально:

### A. API-токены

Таблица: Название / Префикс (`<code>crm_abc…xyz</code>`) / Права (chips) / Последний раз / Создан / Статус (Активен/Отозван) / Действия (Отозвать или Удалить).

Кнопка «Новый токен» открывает модалку:
- Название *
- Чекбоксы прав: «Создавать лидов (leads:create)», «Создавать заказы (orders:create)»
- Hint: «После создания токен будет показан ОДИН раз — скопируйте его сразу.»

После создания — **модалка с токеном**:
- Тёмный code-блок с самим токеном (например `crm_AbCd1234EfGh5678...`)
- Большая кнопка «Скопировать»
- Предупреждение: «Это значение больше нигде не будет показано.»

### B. Исходящие вебхуки

Таблица: Название / URL (monospace truncated) / События / Доставок / Последняя (с HTTP-кодом) / Статус (Вкл/Выкл toggle) / Действия (Вкл-Выкл, Удалить).

Кнопка «Новый webhook» → модалка:
- Название *
- URL *
- События (select с preset'ами: «Все», «Только заказы», «Платежи»)
- Секрет для HMAC (опционально)
- Hint: «Мы пошлём POST с JSON {event, payload, ts}. С секретом — добавим заголовок X-CRM-Signature: sha256=…»

### C. Документация — 4 карточки в 2 колонки

1. 🌐 **Свой лендинг / сайт**:
```html
<script src="https://crm.example.com/embed/form.js"
        data-token="ВАШ_ТОКЕН"
        data-marketplace="Сайт example.com"></script>
```

2. 📥 **Прямой вызов API**:
```http
POST /api/external/leads
X-API-Token: ВАШ_ТОКЕН
Content-Type: application/json

{ "first_name": "Иван", ... }
```

3. 🤖 **Telegram-бот** — ссылка на пример в репозитории.

4. 📡 **Webhook на ваши системы** — пояснение и преимущества.

---

## 17. Страницы-таблицы `/deals`, `/leads`, `/contacts`, `/companies`, `/activities`, `/users`, `/invitations`

Универсальный паттерн. Reusable компонент `<ResourceTable>`:

- Page header: заголовок + сабтайтл + CTA «Добавить»
- Toolbar: поиск + фильтры (специфичные для ресурса)
- Таблица: колонки специфичные, последняя — «Действия» (Редактировать / Удалить)
- Пагинатор снизу: «Всего: 142 · 1 / 6 · ‹ ›»

**Empty states** с подробными подсказками (если поиск пустой — поясн. что это и как пользоваться):
- companies: 🏢 «Компании: пока пусто» / «Компании — это юрлица, с которыми ведутся сделки.»
- contacts: 👥 «Контакты: пока пусто» / «Контакты — это конкретные люди (представители компаний).»
- leads: 🌱 «Лиды: пока пусто» / «Лиды — потенциальные клиенты. Когда лид готов к сделке, нажмите «Конвертировать».»
- deals: 💼 «Сделки: пока пусто» / «На странице «Воронка» их удобно двигать мышью.»
- activities: 📋 «Задачи: пока пусто» / «Задачи — звонки, встречи, дела. Привязываются к контактам, компаниям, лидам или сделкам.»

Для деталей конкретных колонок и форм — придумай разумно по полям из типов в разделе 4.

---

## 18. Страница `/accept` — приём приглашения

URL `/accept?token=XXX`. Без сайдбара, центрированная карточка как login:
- Если токен невалиден: «Приглашение не найдено», кнопка «К входу»
- Если использовано: «Приглашение уже использовано», кнопка «Войти»
- Если просрочено: «Приглашение просрочено», текст «Попросите менеджера выслать новое»
- Если ОК: показать инфу (email, роль, кто пригласил) и форму:
  - Имя (текст)
  - Пароль (минимум 8 символов)
  - Кнопка «Создать аккаунт»

---

## 19. Onboarding-тур (при первом входе)

Опциональный flow для первого захода. Сохрани состояние в localStorage `tour_completed`.

- Полупрозрачный backdrop с «spotlight» вырезом вокруг подсвеченного элемента
- Tooltip popup рядом со spotlight: счётчик «1/5», заголовок шага, 1-2 предложения, кнопки «Назад» / «Далее» / «Пропустить»
- Шаги для менеджера: приветствие → воронка → Ctrl+K → уведомления → каталог
- Шаги для склада: приветствие → канбан заказов → уведомления
- Шаги для админа: приветствие → интеграции → пользователи → подтверждение платежей

---

## 20. Адаптив (mobile ≤640px)

- Сайдбар становится drawer (slide-in слева), триггер — гамбургер в топбаре
- Топбар появляется только на мобиле: гамбургер + Логотип + 🔍 + 🔔
- Таблицы становятся карточками (одна строка таблицы = одна карточка)
- Канбан — horizontal snap-scroll, одна колонка занимает ~85% ширины экрана, видна часть соседней
- 2-колоночные формы переходят в 1 колонку
- Quick-add бокс в форме заказа — поиск и полоса популярных сохраняются (полоса по-прежнему скроллится горизонтально)
- Опционально — bottom navigation bar с 4 пунктами: Дашборд / Сделки / Заказы / Меню

---

## 21. Лого

В `public/logo.svg` положи плейсхолдер (например, синий прямоугольник с белой надписью «LOGO»). Я заменю его на свой файл. Используется в:
- Сайдбаре (32px height) — `app/(dashboard)/layout.tsx`
- Login и Accept страницах (48px height)
- Embed-форме (24px height)

В коде везде ссылайся как `<Image src="/logo.svg" alt="CRM" width={...} height={...} />`.

---

## 22. Что НЕ нужно делать

- Не реализуй API/бэкенд — у меня свой Node.js + Postgres
- Не реализуй авторизацию (логин — UI-only, без проверки)
- Не подключай реальные платёжные системы
- Используй mock-данные везде
- Не используй сторонние UI-киты кроме shadcn/ui

---

## 23. На выходе

После генерации экспортируй проект как ZIP. Все компоненты должны быть **визуально готовы и кликабельны** — клики по навигации переключают экраны, drag-drop работает с моковыми данными, поиск фильтрует мок-список, модалки открываются и закрываются. Бэкенд не нужен — всё на client-side state.

В корне приложи `README.md` с инструкцией: `npm install && npm run dev` и где лежит mock-data.
