# PROJECT-MAP.md — карта репозитория

> **Зачем этот файл.** Чтобы не «искать на ощупь» при правках. Сюда складываются:
> где что лежит, чем что-то отличается от соседа, неочевидные связи между
> файлами, граблезоны. **При любом изменении кода — обнови соответствующий
> раздел тут.** Если меняешь схему БД — секцию «Схема». Если добавил роут —
> секцию «Бэкенд». Это не документация для конечного пользователя; это
> инструкция «куда смотреть, чтобы не сломать».
>
> Уровень выше — `CLAUDE.md` (рабочие ветки, деплой, доменные решения,
> правила обращения с feedback и AI). `AI-DAILY.md` — алгоритм ежедневного
> AI-обхода. Этот файл — **топография кода**.

---

## 1. Стек и слои

```
┌──────────────────────────────────────────────────────────────┐
│                       Vercel serverless                      │
│  ┌─────────────────────┐         ┌────────────────────────┐  │
│  │  Express (src/)     │         │  Static (public/)      │  │
│  │  api/index.js       │         │  index.html + js + css │  │
│  └──────────┬──────────┘         └────────────┬───────────┘  │
└─────────────┼──────────────────────────────────┼─────────────┘
              │                                  │
       ┌──────▼──────┐                  ┌────────▼────────┐
       │  Postgres   │                  │ Browser / PWA   │
       │ (external)  │                  │  Vanilla JS SPA │
       └─────────────┘                  └─────────────────┘
```

- **Сборщика нет.** Прод-минификация — `scripts/minify.mjs` (esbuild),
  запускается через `npm run build` (см. `vercel.json` → `buildCommand`).
- **PWA.** `public/sw.js` + `manifest.webmanifest`. `minify.mjs` стэмпит
  `__BUILD_VERSION__` в SW на каждом деплое → клиент видит баннер «Обновить».
- **БД доступна только через API.** Прямого доступа из MCP в прод-Postgres
  нет (см. `CLAUDE.md` — Supabase MCP = другие проекты).

## 2. Каталог файлов

### Бэкенд (`src/`)

| Файл | За что отвечает |
|---|---|
| `app.js` | Express setup, монтаж роутов, CORS, ETag off, trust proxy, MS-queue tick |
| `server.js` | Локальный запуск (`npm run dev`) |
| `db.js` | Подключение к Postgres + `ensureInitialized()` (миграции, SCHEMA_VERSION-гейт) |
| `auth.js` | JWT-логика, `authenticate` middleware, `requireRole`, имперсонация (admin → роль) |
| `access.js` | `getAccessibleUserIds` / `canAccessUser` / `canAccessOwner` — кто что видит по иерархии |
| `query.js` | `parsePagination`, `parseSort`, `paginated` — хелперы для роутов |
| `errors.js` | `BadRequest`, `Forbidden`, `NotFound`, `Unauthorized`, `asyncHandler` |
| `config.js` | Конфиг + дефолты (⚠ `JWT_SECRET`/`ADMIN_PASSWORD` пока дефолты — см. бэклог). `moyskladWebhookSecret` = `MOYSKLAD_WEBHOOK_SECRET` env (если пустой — HMAC-валидация МС-вебхука пропускается) |
| `middleware/apiToken.js` | `requireApiToken` + `requireScope` для `/api/external` |
| `db/seed.js` | Сид-данные (вызывается через `npm run seed`) |

### Роуты (`src/routes/`)

| Роут-файл | URL-префикс | Что внутри |
|---|---|---|
| `auth.js` | `/api/auth` | login, accept-invite, impersonate, change-password, me |
| `users.js` | `/api/users` | CRUD пользователей, `access_blocks` |
| `companies.js` | `/api/companies` | CRUD компаний |
| `contacts.js` | `/api/contacts` | CRUD контактов |
| `leads.js` | `/api/leads` | CRUD лидов |
| `deals.js` | `/api/deals` | CRUD сделок + `/pipeline`, `/win`, `/lose` |
| `activities.js` | `/api/activities` | CRUD задач + `/complete` |
| `notes.js` | `/api/notes` | заметки |
| `dashboard.js` | `/api/dashboard` | агрегаты для главной: `/stats`, `/insights` (динамика/топ за неделю-квартал), `/recent`, **`/daily-sales`** (детально за КОНКРЕТНЫЙ день по МСК + фильтр по менеджеру: summary, by_status/marketplace/manager, top_products, список заказов; scope через `getAccessibleUserIds`; день = `(created_at AT TIME ZONE 'Europe/Moscow')::date`) |
| `invitations.js` | `/api/invitations` | приглашения |
| `orders.js` | `/api/orders` | **БОЛЬШОЙ** — заказы, импорт CSV, экспорт CSV (одна строка на товар, поддерживает `ids=`/`shipped_from`/`shipped_to`), лист сборки, возвраты, потери, recent-items, `/shipped-archive` (по умолчанию последние 200 отгруженных; с `shipped_from`/`shipped_to` — весь диапазон без лимита, для архива на странице Отгрузок) |
| `payments.js` | `/api/payments` | платежи / подтверждение / отклонение |
| `cashbox.js` | `/api/cashbox` | касса менеджера |
| `external.js` | `/api/external/...` | приём заявок снаружи по API-токену (лиды + заказы) |
| `apiTokens.js` | `/api/api-tokens` | управление токенами интеграций |
| `webhooks.js` | `/api/webhooks` | исходящие вебхуки на доменные события |
| `msWebhook.js` | `/api/webhooks/moysklad-stock` | POST-вебхук от МойСклад (без JWT) + HMAC-валидация `X-Lognex-Signature`; фоновая синхронизация остатков по всем MS-товарам. Монтируется в `app.js` **до** `authenticate` |
| `notifications.js` | `/api/notifications` | колокольчик пользователя |
| `notificationPrefs.js` | `/api/notification-prefs` | пер-юзер тумблеры МАХ-уведомлений |
| `notifications`*-related* | (registry в `services/notification-types.js`) | список типов + шаблоны |
| `search.js` | `/api/search` | глобальный поиск |
| `products.js` | `/api/products` | каталог, прайсы, склады, шаблоны импорта, МойСклад-интеграция |
| `pricing.js` | `/api/pricing` | способы оплаты + пороги скидок; **ревизия прайса и ознакомление**: `/revision` (статус юзера), `/acknowledge` (подтвердить), `/ack-status` (админ/РОП — кто подтвердил). Логика в `services/priceRevision.js` |
| `warehouseSettings.js` | `/api/warehouse` | график отгрузок + видимость складов |
| `analytics.js` | `/api/analytics` | revenue/managers/marketplaces/products/funnel/summary |
| `admin.js` | `/api/admin` | бэкап БД, wipe-operational |
| `feedback.js` | `/api/feedback` | обращения + тред + аттачменты |
| `cron.js` | `/api/cron/refresh-stocks` | Vercel-cron остатков МойСклада |
| `max.js` | `/api/max` | МАХ-бот (вебхук, привязка, диагностика) |
| `aiProposals.js` | `/api/ai-proposals` | inbox админа для предложений AI + тред заметок (`/messages`) |
| `noticeBanners.js` | `/api/notice-banners` | админ-управляемые плашки сверху |
| `projects.js` | `/api/projects` | проекты (стикеры на лидах/сделках/заказах/контактах/компаниях) |
| `materials.js` | `/api/materials` | **PROD-модуль** — материалы (сырьё/комплектующие). НЕ путать с products |
| `processingPlans.js` | `/api/processing-plans` | техкарты (продукт + норма труда + список материалов с qty_per_unit) |
| `productionOrders.js` | `/api/production-orders` | планы выпуска товаров штуками за период с разбивкой по дням |
| `contracts.js` | `/api/contracts` | подряды (клиентские заказы на изготовление) + этапы + материалы + труд + прочие расходы |
| `productionRequests.js` | `/api/production-requests` | **МОДУЛЬ «ПРОСЧЁТЫ ПРОИЗВОДСТВА»** (SCHEMA_VERSION 36). Флоу: менеджер → просчёт производством → согласование с клиентом → работа → выплата. Модель: `production_requests` (title/description/deadline/manager_id/contact_id+company_id [клиент обязателен]/status[10 значений: draft→awaiting_cost→priced→negotiating|approved→in_progress→fulfilled→paid + cancelled/rejected]/cost_price/client_price/reward_type[percent|fixed]/reward_value/reward_computed/priced_by/priced_at/approved_at/fulfilled_at/paid_at/cancel_reason), `production_request_files` (в БД как base64, до 10×10МБ), `production_request_price_history` (initial_price/manager_counter/production_reprice/rejected/cancelled/approved/fulfilled/paid). Роуты: GET / (list с фильтрами status/manager_id), GET /:id, POST / (create, файлы можно inline или потом через POST /:id/files), PATCH /:id (только draft), POST /:id/{submit,price,reject,approve,counter,cancel,start,fulfill,pay}, GET /files/:fileId (скачивание, отдаёт binary через Buffer.from base64), DELETE /files/:fileId. Права: менеджер видит СВОИ заявки + БЕЗ cost_price (санитайзер `sanitizeRequest` в routes/productionRequests.js); director_prod/foreman видят всё, могут просчитывать; admin/rop видят всё + переход в 'paid'. Расчёт reward: percent → client_price × value/100; fixed → value. Global express.json({limit:'20mb'}) поднят с 1mb под base64-файлы; UI грузит файлы по одному через `/files` (устойчивее). UI — отдельный `public/js/productionRequests.js` (не в views.js), рендер — канбан по колонкам статусов, модалки: создание (клиент-поиск через /api/contacts + /api/companies), просмотр (действия зависят от статуса+роли), просчёт, counter (торг), выплата. |
| `calling.js` | `/api/calling` | **МОДУЛЬ «ОБЗВОН»** (SCHEMA_VERSION 33). Cold-calling базы: `calling_campaigns` (id/name/type[production_order|product_sales]/status/description/required_points JSONB/target_calls_per_day) + расширение `leads` (campaign_id/qualification/next_call_at/city/industry/inn/website/size_hint/raw_import_row) + `call_attempts` (lead_id/user_id/outcome/note/next_call_at/covered_points). Флаги на `users`: `is_active_caller` (админ даёт право), `calling_ready` (сам менеджер ставит «готов/нет»), `calling_capacity` (лимит, дефолт 30). Роуты: `GET/POST/PATCH /campaigns`, `POST /campaigns/:id/import` (нормализация phone `+7...`, дедуп по phone внутри файла и в этой же кампании; conflict_mode='include'/'skip' для дублей в других кампаниях), `POST /campaigns/:id/distribute` (round-robin по manager_ids), `GET /my-tasks?scope=today|callbacks|all`, `GET /leads/:id` (с историей попыток), `POST /leads/:id/attempts` (в транзакции: attempt + обновление leads.qualification/next_call_at, синхронизация leads.status), `GET /stats/campaign/:id` (by_qualification/by_manager/overdue_callbacks), `GET /stats/managers?days=30`, `GET /active-managers`. UI — отдельный файл `public/js/calling.js` (не в views.js), вкладки: Мои задачи / Кампании / Аналитика / Обзвонщики. Меню: `#/calling` с `callerOnly: true` — admin/rop видят всегда, остальные — только с `is_active_caller`. Флаги в `req.user` подгружает `auth.js` (best-effort). |
| `supplyDelivery.js` | `/api/supply-delivery` | **ТЕСТ-ЗОНА «Поставки → Доставки»** (ТЗ 18.07.2026). Phase 1 — изоляция: `/flag`, `/settings` (админ: вкл/выкл + тест-юзеры), `/overview`. Phase 2a — справочники (под `requireOperate`): `/packaging-tariffs` (+ `/:id/history`), `/reward`, `/thresholds`. Фиче-флаг `services/featureFlags.js` (по умолчанию ВЫКЛ). Phase 2b — сущности: `/supplies` (+ `/:id/items`), `/deliveries` (+ `/:id/supplies`, `/:id/packaging`), `/finance-settings`; упаковка снапшотит тариф). Phase 2c — `/channel-accounts` (админ: канал+юрлицо+API-ключ шифрован через secrets.js, привязка к менеджеру); упаковка теперь тип+**единица измерения**+стоимость (минуты убраны); финмодель `computeDeliveryFinance` = вознаграждение − (упаковка + зарплата(время×ставка) + логистика). **Вознаграждение склада теперь НА КАЖДОМ СЕТЕ** (`sd_sets.warehouse_reward`), а не глобально: доставка суммирует `Σ set.warehouse_reward × кол-во`; глобальный справочник вознаграждения убран из UI. В «Книге сетов» — предварительный доход сета (вознагр. − упаковка − время×ставка) в редакторе (вживую) и колонкой в списке; **фильтр** «Без вознаграждения»/«Без габаритов». `GET /sets/:id` отдаёт `labor_rate_per_min`. **UI тест-зоны:** секции свёрнуты по умолчанию + ленивая загрузка (`sdCollapsible`); matching-список с пагинацией (`offset`/`has_more`, «Показать ещё»). Таблицы `sd_*` лениво в `services/supplyDeliverySchema.js` (без бампа SCHEMA_VERSION). Phase 2e — **книга сетов**: `/sets` (+ `/:id/components`, `/:id/packaging`) — сет = артикул маркетплейса (комбинация артикулов склада) + упаковка/габариты/время. Продуктовый справочник упаковки (Phase 2d) заменён сетами. **Упаковка сета — МНОГО типов** (`sd_set_packaging`: тариф+расход; напр. стретч-плёнка + коробка), а не одна; стоимость упаковки сета = Σ(расход×цена тарифа). Старое одиночное поле (`sd_sets.packaging_tariff_id/consumption`) мигрируется в `sd_set_packaging` разово (флаг `packaging_migrated`, не воскресает при холодном старте). Финмодель ДЕРИВАЕТ упаковку/время из позиций доставки → `channel_map` (по каналу+SKU/ШК) → **сет** (LATERAL); упаковка = Σ по строкам `sd_set_packaging` × кол-во позиции, зарплата = время × ставка ₽/мин. Сопоставление канал-SKU → **set_id** (не product_id); в окне «Сопоставить с сетом» есть «+ Новый сет» (`sdQuickCreateSet` — вложенная модалка, создаёт сет и сразу подставляет выбранным). В «Изменить сет»: упаковка — список строк (+/🗑), «Добавить компонент» сразу подгружает товары МойСклад (авто-поиск `/product-directory`, живой поиск), поле **«Артикул сета»**. **Импорт сетов из МС (Phase 2f, ЧТЕНИЕ):** `POST /sets/pull-ms` — комплекты (bundle) МойСклад из папки (по умолч. «Комплект RUS», `fetchMoyskladBundlesPage` в `moysklad.js`: фильтр по папке НА СТОРОНЕ МС через **`/entity/assortment?filter=productFolder=<href>`** (bundle сам productFolder-фильтр НЕ поддерживает — ошибка 1034; assortment — поддерживает), берём `type=bundle`; папку резолвим в href (`resolveMsFolderHref`) один раз и фронт носит его в `folder_href`. Постранично (limit=50), состав параллельно (5). Эндпоинт: **батч** резолва товаров каталога (`external_id = ANY(?)`) + батч-вставка компонентов (не N+1). Фронт (`sdPullMsSetsModal`) листает по `has_more` с прогрессом; **после подтяжки авто-запускает `auto-match-article` для wb/ozon/ym**. ⚠️ Эволюция фикса 504: весь аккаунт одним запросом → постранично по всему аккаунту → **скоуп по папке через assortment + батч БД** (только комплекты папки, а не весь аккаунт). `request()` в `api.js` ловит не-JSON (504→«не уложились в лимит») → `sd_sets` (name+`article`+`ms_bundle_id`, идемпотентно по ms_bundle_id) + состав (компонент.assortment UUID = `products.external_id`). Состав МС-сетов пересобирается при каждом pull (МС = источник истины). `sd_sets`: +`article`,`ms_bundle_id`(uniq),`ms_synced_at`. **Обратная запись CRM→МС (ПИШЕТ В БОЕВОЙ МС):** `POST /sets/:id/push-ms` (`pushMoyskladBundle` в `moysklad.js`) — создаёт комплект (POST /entity/bundle, папка «Комплект RUS», `overhead`+`components`) или обновляет связанный (PUT). Тип ассортимента компонента (product/variant) резолвится пробой `/entity/{type}/{id}`. Ручная кнопка «⬆ МС» на строке сета. ⚠️ Payload комплекта собран по API 1.2 без живой проверки — ошибки МС отдаём verbatim. **Маппинг по артикулу сета:** `POST /channel-map/auto-match-article` — поле канала = артикулу сета зависит от площадки: WB→`channel_sku` (артикул продавца), Ozon→`channel_barcode` (штрихкод), ЯМ→`channel_sku` (SKU); в UI кнопка «Авто по артикулу сета». ⚠️ Литералы с `?` в SQL ломают конвертер `?`→`$n` (`db.js`) — в `STRING_AGG` фолбэк-строка `'—'`, не `'?'`. Phase 3 (старт, WB) — **matching канал⇄МойСклад**: `/channel-map` (список), `/channel-map/import` (ручной), `/channel-map/pull-wb` (подтяжка WB Content API по ключу из «Каналы», `services/channelApis.js`; тянет по ОДНОМУ `channel_account_id`; `fetchWbCards` **листает курсор** — WB отдаёт ≤100 карточек/страница, `cursor.updatedAt`+`nmID` → следующая, пока `cursor.total<limit`; upsert батчами по 200 с дедупом по ключу конфликта. ⚠️ Раньше был баг: один запрос без пагинации → только первые ~100 карточек), `/auto-match` (артикул канала = внутр. sku), `/:id/match|unmatch`. Таблица `sd_product_channel_map` (+ `channel_account_id` — из какого юрлица подтянуто). **Мульти-юрлицо:** `/channel-map` принимает фильтр `channel_account_id` и отдаёт `legal_entity`; в UI — селектор юрлица (из `/wb/accounts`), фильтрует список И подтяжку. Подтяжка: выбранное юрлицо → одно, «Все юрлица» → цикл по всем WB-каналам (фронт зовёт `pull-wb` на каждый). ⚠️ Раньше был баг: бралось только первое юрлицо (`.find(...)`). **Универсальная модалка подтяжки (`sdPullFromMpModal`):** «⬇ Подтянуть из МП» → чекбоксы по всем заведённым каналам (WB/Ozon/ЯМ) × юрлицам, точечная выборка. `POST /channel-map/pull-ozon` (`fetchOzonCards`: v3/product/list + v3/product/info/list, курсор `last_id`, габариты мм→см; ключ = JSON `{client_id,api_key}` или `client_id:api_key`), `POST /channel-map/pull-ym` (`fetchYmCards`: `/businesses/{businessId}/offer-mappings`, курсор `nextPageToken`; ключ = JSON `{token,business_id}` или `business_id:token`). После подтяжки автозапуск `auto-match-article` по каналам, где были подтяжки. Общий батч-upsert `upsertChannelItems`. **Сверка габаритов МП ⇄ сет:** `sd_product_channel_map.channel_dim_l/w/h`, `GET /size-map?channel=&threshold=` — CRM эталон, отклонение = `|МП−CRM|/CRM×100`; UI-секция «📐 Сверка габаритов» с полем «% отклонения», строки-нарушители красные. **Скрытие строк** (таблица длинная, с телефона тяжело): `sd_product_channel_map.hidden`, GET `/channel-map` — фильтр `visibility` (active/hidden/all, дефолт прячет скрытые) + счётчик `hidden`; `PUT /channel-map/:id/hidden`, `POST /channel-map/hide-matched` (скрыть все сопоставленные канала); в UI — селектор видимости, 🙈/👁 на строке, «Скрыть сопоставленные», таблица в `overflow-x`. **Связь сета с артикулом МП из карточки сета:** `POST /sets/:id/channel-links` (связать существующую строку `map_id` ИЛИ создать вручную barcode/sku+name с upsert set_id); GET `/sets/:id` отдаёт `channel_links`; отвязка — `/channel-map/:id/unmatch`; UI — секция «Артикулы на каналах» + «+ Добавить канал и связь» (`sdAddChannelLinkModal`: выбор из ЗАВЕДЁННЫХ каналов-юрлиц (`GET /channel-accounts-lite` → «WB · ИП Иваненко»), поиск номенклатуры только этого юрлица (`channel_account_id`), либо ручной ввод; `POST /sets/:id/channel-links` принимает `channel_account_id` и тегирует им ручные строки). **WB ФБС процесс** (`services/channelApis.js` WB Marketplace API): `/supplies/:id/wb/create-supply` (POST /api/v3/supplies), `/wb/new-orders` (сборочные задания), `/wb/attach-order` (PATCH привязка задания), `/wb/barcode`, `/wb/deliver` (PATCH передать в доставку), `/wb/reshipment`. Поставка хранит `channel_account_id` (какой WB-ключ) + `external_supply_id`. Ключ WB — из справочника «Каналы». Ozon/ЯМ + ФБО/недогруз — след. UI: `renderSupplyDelivery` в views.js |

> **TEMP diag-роуты.** Авто-claude иногда заводит файлы вроде
> `routes/diagDaily.js` под `/api/diag/...` для разовой диагностики
> прод-БД через `web_fetch_vercel_url`. Они помечены TEMP и сносятся в
> том же раунде (см. `chore(diag): remove ...` коммиты). В постоянных
> файлах их быть не должно.

### Сервисы (`src/services/`)

| Файл | За что отвечает |
|---|---|
| `audit.js` | `logAction(req, {action, entity_type, entity_id, details})` → `audit_log` |
| `csv.js` | `toCsv(rows, columns)` для экспортов |
| `labels-pdf.js` | PDF этикетки для отгрузки (bwip-js + pdfkit) |
| `max-bot.js` | MAX API клиент, `sendMaxMessage`, `setMaxWebhook`, `handleMaxUpdate` |
| `moysklad.js` | низкоуровневый MS-клиент + ретраи |
| `ms-handlers.js` | регистрирует обработчики типов задач MS-очереди (импорт через side-effect) |
| `ms-jobs.js` | очередь MS-задач: `enqueueMsJob`, `tickMsQueue` (опрос таблицы `ms_jobs`) |
| `ms-orders.js` | конкретные MS-операции: customerorder, demand, salesreturn, loss, markdown |
| `notifications.js` | `notify`, `notifyMany`, `notifyAdmins(AndManagers)`, `notifyWarehouse` + `buildOrderNotificationBody` |
| `notification-types.js` | реестр 11 типов уведомлений (key/label/template/roles) |
| `secrets.js` | хранение и чтение секретов МАХ-бота из app_settings |
| `shippingSchedule.js` | расчёт ближайшей даты отгрузки по графику + cutoff МСК |
| `priceRevision.js` | ревизия прайса = `MAX(product_prices.updated_at)`; подтверждения менеджеров (`price_acknowledgements`, ленивое создание). **МЯГКАЯ версия — НЕ блокирует заказы** (только баннер + отчёт, чтобы не трогать бизнес-логику/деньги — жёсткий блок откатывался daily-run по AI-DAILY.md). Баннер во фронте `app.js loadPriceAckBanner`, статус у админа — кнопка «👥 Ознакомление с прайсом» на странице товаров |
| `featureFlags.js` | фиче-флаги / тест-зоны. Первый потребитель — модуль «Поставки → Доставки». `getSupplyDeliveryConfig`/`setSupplyDeliveryConfig` (app_settings `features.supply_delivery` = `{enabled, test_user_ids}`), `canSeeSupplyDelivery` (админ всегда; тест-юзер при enabled), `canOperateSupplyDelivery` (только при enabled). Фронт: пункт меню «🧪 Тест» под флагом, `renderSupplyDelivery` в views.js |
| `webhooks.js` | `emitEvent` — отправка исходящих вебхуков подписчикам |

### Фронтенд (`public/`)

| Файл | За что отвечает |
|---|---|
| `index.html` | HTML-шапка, PWA-метатеги, манифест, иконки |
| `manifest.webmanifest` | PWA-манифест (name/icons/standalone/theme) |
| `sw.js` | service-worker (только детект обновлений; НЕ кеширует) |
| `icon-*.png`, `favicon.ico` | иконки разных размеров |
| `css/styles.css` | **ОДИН файл со всеми стилями** (~2500 строк). Разделён комментариями по фичам |
| `js/api.js` | `request(method, path, opts)` + методы (`api.list`, `api.get`, ...). Сессия в localStorage |
| `js/ui.js` | `el`, `clear`, `fmt*`, `tr`, `toast`, `confirm`, `openModal`, `paginator`, `emptyState` |
| `js/app.js` | bootstrap: hash-роутинг, sidebar, mobile menu, PWA-регистрация, колокольчик-polling, уведомления |
| `js/views.js` | **БОЛЬШОЙ (>10000 строк)** — все экранные рендереры (см. ниже) |
| `embed/form.js` | публичная встраиваемая форма заявки (с лидом-режимом) |

### Скрипты (`scripts/`)

| Файл | Назначение |
|---|---|
| `minify.mjs` | прод-минификация JS + стэмп `__BUILD_VERSION__` в `sw.js` |
| `gen-icons.mjs` | генератор PWA-иконок (PNG через zlib) |
| `deploy.sh`, `deploy-continue.sh` | вспомогательные скрипты деплоя |

### Конфигурация деплоя

| Файл | Зачем |
|---|---|
| `vercel.json` | Vercel-конфиг (functions, rewrites `/api/*` → `api/index`, cron 15-минутный) |
| `api/index.js` | Vercel entry: импорт `createApp` + `ensureInitialized` |
| `package.json` | scripts: `start`/`dev`/`test`/`seed`/`build` |
| `deploy/install.sh`, `deploy/README.md` | one-shot setup VPS-прокси (nginx + Let's Encrypt) |

## 3. Топ-уровневые render-функции в `views.js`

`public/js/views.js` — одно большое полотно. Карта точек входа:

| Функция | URL хеш | Что показывает |
|---|---|---|
| `renderDashboard` | `#/dashboard` | главная: статы + последние события. Для admin/rop сверху — **`renderDailySales`** (продажи за день: дата+менеджер, карточки, разбивки, «что продано», список заказов дня); ниже — `renderInsightsWidgets` (динамика/топ за период) |
| `renderPipeline` | `#/pipeline` | канбан сделок (drag&drop по этапам) |
| `renderResource(main, key, opts)` | `#/leads`, `#/contacts`, `#/companies`, `#/deals`, `#/activities`, `#/users` | универсальный CRUD-список ресурса (`RESOURCES[key]` — конфиг) |
| `renderOrders(main, opts)` | `#/orders` | продажи с площадок. **directMode=false** в коде = «не B2B». Канбан («комбайн»): колонка «Ожидает товара» для sales/manager по умолчанию показывает только СВОИ заказы (по `manager_id`), кнопка в шапке «Показать чужие (N)» ⇄ «Только мои»; админ/РОП по умолчанию видят все. Данные уже приходят (бэк отдаёт все `waiting_stock`), фильтр клиентский; чужие карточки помечены 👤 менеджером |
| `renderDirectOrders` | `#/direct-orders` | B2B-заказы. Прокси `renderOrders(main, {..., directMode: true})` |
| `renderShipping` | `#/shipping` | график отгрузок для склада. Для admin/warehouse внизу — lazy-loaded «Архив отгрузок» (`api.shippedArchive({shipped_from, shipped_to})`), сгруппированный по `shipped_at`, с фильтром по диапазону дат отгрузки и выгрузкой (Excel/PDF-этикетки) только выделенных строк (или всех по текущему фильтру, если ничего не выделено) — fb#59 |
| `renderReturns` | `#/returns` | возвраты, обработка складом |
| `renderLostGoods` | `#/lost-goods` | потерянные товары + аннулирование |
| `renderProducts` | `#/products` | каталог + прайсы + импорт МойСклад |
| `renderCashbox` | `#/cashbox` | касса менеджера |
| `renderAnalytics` | `#/analytics` | аналитика для admin/rop |
| `renderIntegrations` | `#/integrations` | админ-настройки: МС, склады, площадки, доставки, оплаты, проекты, MAX |
| `renderInvitations` | `#/invitations` | приглашения |
| `renderFeedback` | `#/feedback` | обращения для админа |
| `renderMyFeedback` | `#/my-feedback` | свои обращения |
| `renderMyProfile` | `#/my-profile` | смена пароля + настройки МАХ-уведомлений |
| `renderAudit` | `#/audit` | лог действий |
| `renderAiInbox` | `#/ai-inbox` | inbox AI-предложений |
| `renderAcceptInvite` | `#/accept?token=…` | приём приглашения без авторизации |
| `renderMaxBotSection` | внутри `renderIntegrations` | MAX-бот: токен, вебхук, диагностика |
| `renderMaterials` | `#/materials` | **PROD** — список материалов + создание/правка |
| `renderProcessingPlans` | `#/processing-plans` | **PROD** — техкарты, инлайн-список материалов с qty, показ себестоимости 1 ед |
| `renderProductionOrders` | `#/production-orders` | **PROD** — план выпуска, утверждение, ввод факта по дням |
| `renderContracts` | `#/contracts` | **PROD** — подряды, чипы этапов (тап = закрыть), материалы/труд/прочие расходы, маржа |
| `renderProductionPL` | `#/production-pl` | **PROD** — P&L: доход (платежи по orders + paid_amount подрядов с production-проектом) − расход (контрактные затраты + ручные `production_expenses`) |

**Внутренние helper-функции в `views.js`** (не экспортируются, но важные):
- `openOrderForm(order, onSaved, opts)` — модал создания/редактирования заказа.
  `opts.b2b=true` или `!order.marketplace` → b2b-режим (см. секцию «Доменные решения»).
  Комиссия: 4 связанных поля (`commissionTxnI` Сумма транзакции / `commissionPctI` % /
  `commissionRubI` ₽ / `commissionNetI` Сумма с комиссией), правка любого пересчитывает
  остальные (`recalcCommission`). В БД на сохранении пишется только `commission: commissionRubI.value`.
  `commissionTxnI` — **read-only**, синхронизируется в `renderPricingPanel()` из суммы позиций
  заказа (`p.actualTotal`) при каждом изменении состава товаров, вручную не редактируется (fb#35).
  Поле «Проект»: видимо только если `meEmail === 'andrreysirko@gmail.com'`.
  **Крупный Avito-заказ со скидкой по объёму** (`marketplace==='Avito'` и `computePricing().availTierPct < 0`,
  т.е. сумма достигла порога объёмной скидки) → ФИО клиента (`client_name`) и классификация
  (`client_classification`) СТАНОВЯТСЯ обязательными: `renderPricingPanel` сбрасывает классификацию в
  пусто (пока `classTouched===false`) + красит поля + баннер; `onSubmit` блокирует сохранение, пока не
  заполнены (цель — занести вероятного B2B в справочник). Enforcement **фронтовый** (гайд для менеджера),
  бэкенд-валидацию не трогали. У `classI` есть пустой вариант «— укажите B2B/B2C —».
- `showOrderDetails(order, reload)` — модал с деталями заказа.
- `openOrderImportModal(onDone, opts)` — модал импорта CSV. `opts.b2b=true` → b2b-шаблон.
- `itemsEditor(initialItems, opts)` — редактор позиций (поиск, популярные, каталог).
- `loadLookups()` — прогрев `CACHE.users/companies/contacts/projects` при заходе в раздел.
- `MARKETPLACES`, `DELIVERY_METHODS`, `FEEDBACK_CATEGORIES` — справочники.

## 4. Доменные решения (что важно держать в голове)

### Заказы: каналы и режимы

CRM разделяет заказы на два потока:

1. **Маркетплейс-заказы** (`marketplace IS NOT NULL`, значения: `Avito`,
   `Wildberries`, `Ozon`, …):
   - Раздел сайдбара «🛒 Авито (менеджеры площадок)» → `#/orders`.
   - Список + канбан фильтруют `marketplace_only=1` на бэке.
   - В форме видны: площадка, ссылка на диалог Avito, номер отправления.
   - Резервировать без `shipment_qr` нельзя.
   - Стандартный access_block = `direct`.

2. **B2B-заказы** (`marketplace IS NULL`, `client_classification='B2B'`):
   - Раздел сайдбара «📋 B2B (менеджеры по продажам)» → `#/direct-orders`.
   - Список + канбан фильтруют `direct=1` (= `marketplace IS NULL`).
   - В форме: НЕТ площадки, НЕТ Avito-диалога, НЕТ трека. Дефолт оплаты
     `rs_no_vat` («РС без НДС»), дефолт классификации `B2B`.
   - Резерв без трека разрешён.
   - Стандартный access_block = `sales`.

Маршрут `#/direct-orders` остался для бэк-совместимости (ссылки в уведомлениях,
закладки) — переименование только в лейбле сайдбара.

### Прайсы: единый «Общий прайс»

- В `product_prices` ключ строки = `(product_id, marketplace, warehouse)`.
- **Раньше** `marketplace` совпадал с площадкой заказа (Avito/WB/...).
- **Сейчас** канал зафиксирован одной строкой `'Общий прайс'`. Миграция в
  `db.js` (SCHEMA_VERSION 19): `UPDATE product_prices SET marketplace='Общий прайс'
  WHERE marketplace='Avito'`. Идемпотентна.
- **Все** lookup-запросы цены жёстко используют `pp.marketplace = 'Общий прайс'`:
  `orders.js` (list/by-id/recent-items), `products.js` (`/for-marketplace`,
  `/popular`), `analytics.js` (top-products).
- Форма цены в карточке товара показывает единственный пункт «Общий прайс».
- Цена редактируется инлайн (`<input>` в строке прайса, save on blur/Enter,
  Esc откат). Кнопка «Удалить» осталась.
- **Если в будущем понадобится per-marketplace pricing** — это снова разводить
  на ключ `marketplace`. Сейчас намеренно унифицировано.
- В `app.js` стоит алиас «Avito → Общий прайс» **только на `/api/products`**
  (страховка для старых CSV/вкладок). НЕ вешать шире: в заказах `marketplace` —
  площадка продажи; глобальный алиас 2026-06-11 переименовывал площадку у
  новых заказов (#274/#275 чинились руками).
- ⚠️ Граблезон миграций: блоки `ensureInitialized` гейтятся ОДНОЙ
  `schema_version` — при бампе прогоняются ВСЕ заново, и каждый старый блок
  обязан быть совместим с ТЕКУЩИМИ данными. Ранний пересоздатель
  `users_role_check` без производственных ролей уронил прод 2026-06-11
  (~7 минут 500-ок), когда бамп v27 перезапустил его поверх существующего
  пользователя `director_prod`.

### Склад, остатки, прайс

- Склад на заказе — `orders.warehouse` (одна строка из списка `app_settings.warehouses.all`).
- Остатки в `products.stock_by_store` (jsonb массив `{store, stock, reserve}`).
- Цена строго привязана к складу (`product_prices.warehouse`). Без склада
  цена запрещена (`priceSchema.warehouse.min(1)`).
- Lookup цены = `(product_id, 'Общий прайс', order.warehouse)`.
- ⚠️ Граблезон МС-batched-UUID (`msFetchStockByProductIds`): batch фильтр
  `filter=product=URL1;product=URL2;…` **стабильно валится «fetch failed»**
  на сетевом уровне (Node fetch + промежуточный TLS/Cloudflare-связка
  ломаются на `;`-разделителе). Single-UUID `filter=product=URL` работает
  стабильно. Поэтому функция теперь делает per-UUID запросы
  последовательно (CONCURRENCY=1): `await fetchOne('product', id)` для
  каждого, потом то же для `variant` для не-найденных. Для батча 10-50
  товаров это занимает ~5-25с — в пределах Vercel 60s.
  Инцидент 2026-06-11 v2: после `refreshProductStocks` перед резервом все
  товары заказа получали `stock_by_store=[]`, резерв валился «недостаточно
  товара» (00466287 — 170 шт в МС, 0 в CRM).
  Чинили: (1) `msFetchStockByProductIds` — per-UUID с concurrency=1;
  (2) callers (`/refresh-stocks`, `stockSyncFresh`, `msWebhook`) НЕ пишут
  пустое/NULL когда МС не вернул — оставляют последнее значение.
- ⚠️ Граблезон cron stock-sync (инцидент 2026-06-12): МС-отчёт
  `/report/stock/bystore` (общий, без filter=) **завис >60с даже на
  limit=100** — cron `/api/cron/refresh-stocks` 24 часа валил 504,
  остатки не обновлялись (SKU 40376218 в CRM был 4шт с резервом 5, в МС
  18шт с резервом 0). Перевели cron на тот же per-UUID путь
  (`msFetchStockByProductIds`), PAGE=20 за тик (~10-20с), schedule
  `*/5` (раньше `*/15`), внутренний дедлайн 45с. Полный обход 4255
  товаров — ~3-4 часа. Очистку архивных делает финальный блок (когда
  обход завершён) через `updated_at < started_at`. Это медленно, но
  **работает** — критичные обновления перед резервом всё равно делает
  `refreshProductStocks` per-order (там per-UUID на 1-10 товаров заказа
  быстро).
- **Ручная кнопка «Обновить остатки из МойСклад»** (Интеграции, `POST
  /api/products/import/moysklad-stock`, admin/aus): раньше — один вызов
  `fetchMoyskladStock`→`fetchAll('/report/stock/all')` на весь каталог, на
  большом каталоге упирался в 60с лимит лямбды → HTTP 504 (2026-08-27).
  Починено: эндпоинт порционный — принимает `{token, offset}`, обрабатывает
  по 500 позиций через `fetchMoyskladStockByStorePage` (тот же хелпер, что у
  cron), отдаёт `{done, next_offset, updated, batch_size}`; фронт
  (`openMoyskladStock` в `views.js`) крутит while-цикл до `done=true`
  (страховка max 100 раундов). Обнуление остатков у товаров, которых МС не
  вернул, из этого пути убрано — оставлено фоновому cron (`refresh-stocks`),
  у ручной кнопки такой ответственности больше нет.
- **МС webhookstock-подписка**: точечное обновление stock_by_store по
  событиям в МС. Принимающий маршрут — `POST /api/webhooks/moysklad-stock`
  (`msWebhook.js`): парсит `events[].meta.href`/`stockUpdate.goodMeta.href`,
  извлекает UUID и делает узкий `msFetchStockByProductIds` ТОЛЬКО по этим
  UUID. Раньше при любом stock-вебхуке делали полный re-sync каталога —
  обжирали бюджет. Управление подпиской: `/api/admin/ms/webhook-stocks`
  (GET/POST/DELETE, admin). Текущая подписка зарегистрирована 2026-06-12
  на `https://crm-orcin-six.vercel.app/api/webhooks/moysklad-stock`,
  `stockType=stock`, `reportType=bystore`. Так стоки приходят в CRM в
  реальном времени, cron остаётся как страховка раз в 5 мин.

### Переходы статуса waiting_stock

Заказ в `waiting_stock` — товара нет. Когда товар поступает, в карточке
доступны две кнопки:
- **«🔄 Проверить и зарезервировать»** (`POST /api/orders/:id/recheck-stock`,
  `routes/orderRecheck.js`): подтягивает свежие остатки из МС только по
  позициям этого заказа (через `msFetchStockByProductIds`), обновляет
  `products.stock_by_store`, проверяет наличие на `orders.warehouse`. Если
  хватает — резервирует одной транзакцией (status='reserved' +
  pending-приход в `payments` + `applyLocalStockReserveDelta(0, +1)` +
  `enqueueMsJob 'customer_order.upsert'`). Если не хватает — остаётся в
  `waiting_stock` и возвращает `{ok:false, missing:[...]}`. Маршрут
  смонтирован в `app.js` ДО `ordersRoutes` (узкий путь, отдельный файл).
- **«✅ Товар поступил»** (`POST /api/orders/:id/mark-ready`) — fallback,
  просто переводит в `new` без проверок остатков.

Доступ к recheck-stock: владелец заказа или admin/warehouse/aus/rop.
Для маркетплейс-заказов проверяется `shipment_qr` — без него возвращаем
сообщение «заполните и нажмите Зарезервировать вручную».

### Видимость заказов (`orderScope`)

В `routes/orders.js`:
- `admin` / `warehouse` → видят все
- `sales` → только свои (`manager_id = user.id`)
- `manager` / `rop` → свои + подчинённых (см. `access.getAccessibleUserIds`)

Это применяется в:
- `GET /api/orders`
- `GET /api/orders/export.csv`
- `GET /api/orders/assembly-list.csv`
- В `GET /api/orders/:id` через `canAccessOrder`.

### Импорт заказов

Эндпоинты:
- `GET /api/orders/import-template.csv` — Avito-шаблон (Артикул/Кол-во/Цена/Способ отправки/Трек номер + справочник).
- `GET /api/orders/import-template-b2b.csv` — B2B-шаблон (то же + Клиент/Телефон).
- `POST /api/orders/import` — парсер CSV. Принимает `b2b=true` →
  `marketplace=NULL`, `classification='B2B'`, дефолт оплаты `rs_no_vat`,
  читает колонки Клиент/Телефон.

**Важно про порядок роутов:** `/import-template*.csv` ОБЯЗАНЫ стоять
ДО роута `/:id`, иначе Express ловит URL как `id="import-template.csv"`
и Postgres валится `invalid integer` → 500. Уже наступали — см. историю
коммитов с `fix(orders): import-template.csv ушёл в 500`.

**Грабля int4-переполнения на `:id`:** `orders.id`/`payments.id` — serial
int4 (макс 2 147 483 647). Если в `:id` или в `payments.order_id` прилетает
Avito-**номер** заказа (лежит в `orders.reference_number`, TEXT, и часто
больше int4) — прямой `WHERE id = ?` роняет драйвер `22003 out of range`
→ 500. Наступали в кассе: «Добавить транзакцию» с Avito-номером в поле
«привязать к заказу». Защита: `router.param('id')` в `orders.js`/`payments.js`
(не-int4 → 404), а в `POST /api/payments` привязка резолвится и по `id`, и
по `reference_number`, всегда сохраняя внутренний id.

### Имперсонация (admin → роль)

`auth.js`:
```js
if (payload.act && user.role === 'admin' && payload.act !== 'admin') {
  user.realRole = 'admin';
  user.role = payload.act;
  user.impersonating = true;
}
```

`orderScope` смотрит на `user.role` — НЕ на `realRole`. То есть админ
в режиме «Смотреть как менеджер» видит то же что менеджер.

На UI: оранжевая sticky-полоса сверху (`.impersonation-bar` в `styles.css`,
рендер в `app.js renderShell`). На мобиле ещё плашка справа сверху с
именем+ролью (`.mobile-user-badge`).

### Глубокие ссылки из уведомлений

`notify(userId, type, title, body, link)` хранит `link` в БД и шлёт в МАХ:
- Хеш-ссылку оборачивает `https://crm.iitit.ru/#…` (см. `services/notifications.js`).
- Формат `#/orders?id=123`, `#/leads?id=42`, `#/feedback?id=7`.
- Все ROUTES принимают `(main, opts)` где `opts.params` = `URLSearchParams`
  из хеша. Каждый renderer сам обрабатывает `opts.params?.get('id')` и
  открывает detail.
- В колокольчике (`renderShell` → `openNotificationsDropdown`) клик по
  записи летит на `href={n.link}` → hashchange → renderApp → detail.

### MAX-бот

- Токен и webhook URL хранятся в `app_settings`. Управляются через
  «Настройки → 🔔 MAX» (admin only).
- Авторизация: `Authorization: <token>` (без `Bearer`!). См. `services/max-bot.js`.
- Юзер привязывает свой чат через deep-link `/start CODE`. Код одноразовый,
  TTL 30 мин (`user.max_bind_code`/`max_bind_expires`).
- Per-user toggles типов уведомлений: `user_notification_prefs(user_id,
  notification_type, enabled)`. Default ON; при сохранении только
  изменённые с дефолта пишутся в БД. Реестр типов — `services/notification-types.js`.

### PWA

- `manifest.webmanifest`: standalone, theme `#111827`, иконки 192/512/maskable.
- `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-capable=yes`,
  `apple-touch-icon` = `icon-180.png`.
- `sw.js`: НЕ кеширует ресурсы. Только триггерит `updatefound` →
  баннер «🔄 Доступна новая версия CRM» снизу → клик `skipWaiting` → reload.
- Версия SW стэмпится `scripts/minify.mjs` на каждом деплое.
- iOS-баннер «📲 Добавьте на экран Домой» (`loadIosInstallBanner` в `app.js`)
  показывается только iPhone-Safari, прячется на 3 дня после «×» или
  навсегда после standalone-инсталла.

### Проекты (стикеры)

Сущность `projects (id, name, color, active, is_production)`. Прикрепляется к
`leads`, `deals`, `orders`, `contacts`, `companies` через `project_id`
(nullable). Управление: «Настройки → Проекты». Фильтр по проекту в
списках + цветной стикер на карточках.

**Поле «Проект» в форме заказа** видно только пользователю с email
`andrreysirko@gmail.com` (два аккаунта Avito). Активные проекты:
«Проект 1» (id=2) и «Проект 2» (id=3). «ЧПБ» (id=1) деактивирован.
Флаг `is_production=true` на всех трёх для P&L производства.

### AI-инбокс предложений + тред заметок

Таблицы: `ai_proposals` (карточка) + `ai_proposal_messages` (тред). AI
постит предложение через `POST /api/ai-proposals` под admin-токеном.
Админ смотрит в `#/ai-inbox`, решает (approved/rejected/revision/done).

Для итеративного уточнения — тред заметок:
- `GET /api/ai-proposals/:id/messages` / `POST .../messages` — простой
  чат. AI постит от имени «AI ассистент» (см. правило в `CLAUDE.md`),
  человек — под своим именем.
- В карточке `#/ai-inbox` блок «💬 Заметки / уточнения» свёрнут по
  умолчанию, разворачивается lazy-load. Ctrl+Enter — быстрая отправка.
- Поле `admin_notes` в `ai_proposals` оставлено для финальной заметки
  при решении (вверху карточки), тред — для всего остального.
- **Важно для AI-обхода:** правило чтения треда прописано в `AI-DAILY.md`
  (раздел «Цикл работы с ai_proposals»). Без этого замечания админа
  между обходами не учитываются.

### Производственный модуль (PROD)

Добавлен в SCHEMA_VERSION 21 по сводному ТЗ. Цель — сырьё, техкарты, выпуск
товаров штуками, подряды клиентов с этапами и P&L.

**Сущности (БД-таблицы):**
- `materials` — материалы (sku, name, unit, cost_price, supplier, warehouse,
  ms_id, active, notes). Отдельная сущность от `products`.
- `processing_plans` — техкарта (один-к-одному с product_id, `labor_minutes_per_unit`, `ms_id`).
- `processing_plan_items` — позиции техкарты (material_id, qty_per_unit, `sizes JSONB` — разбивка по типоразмерам: `[{count, label}]`). Поле добавлено в SCHEMA_VERSION 28.
- `production_orders` — план выпуска: product_id, plan_qty, period_from/to,
  foreman_id, status `draft|approved|in_progress|done|cancelled`.
- `production_order_days` — дневная разбивка (plan_qty + fact_qty + backdated + over_plan).
- `production_plan_changes` — журнал значимых правок плана после утверждения.
- `contracts` — подряд (client_*, total_amount, paid_amount, manager_id,
  status `draft|in_progress|done|cancelled`).
- `contract_stages` — 5 фиксированных этапов: `measure|cut|weld|paint|ship`
  (plan_date, fact_date, closed_by, closed_at). При создании подряда
  автоматически заводятся 5 строк.
- `contract_materials` — материалы, списанные на подряд (qty, unit_price на
  момент списания).
- `contract_labor_logs` — труд по подряду (minutes × rate_per_minute = amount).
  rate берётся из `app_settings.production.labor_rate_per_minute`.
- `contract_other_expenses` — прочие прямые расходы.

**Роли (RBAC):**
- `director_prod` (директор производства) — всё в PROD-модуле.
- `foreman` (начальник цеха) — техкарты, свои production_orders (foreman_id), материалы (просмотр), факт.
- `master` (мастер) — только свои production_orders (foreman_id) и factsubmit.
  **НЕ видит** цен материалов, себестоимости, маржи. Бэк фильтрует поля.
- `supply` (снабжение) — материалы (создание/правка с cost_price, поставщики).

В `routes/auth.js IMPERSONATE_ROLES`, `routes/users.js ROLE_ENUM`,
`routes/invitations.js`, `ui.js T.role`, БД `users_role_check` /
`invitations_role_check` — все four новых ролей добавлены.

**P&L подрядов:**
- В `GET /api/contracts/:id` для admin/director_prod считается `cost_total`
  и `margin` (paid − cost) на лету. Для остальных эти поля + amounts
  скрываются (`stripMoney`).

**Себестоимость техкарты:**
- В `GET /api/processing-plans/:id` для admin/director_prod/foreman/supply
  считается `cost_per_unit = materials_total + labor_total`, где
  `labor_total = labor_minutes × labor_rate`.

**Что ещё НЕ сделано (следующие итерации):**
- Операция «Выполнили заказ» → создание `entity/processing` в МойСклад
  через `ms_jobs` (новый job-тип `processing.create`). Соответственно
  списание материалов и оприходование готовых товаров на внутренний склад.
- Синхронизация материалов в МС (`entity/product`) и техкарт (`entity/processingplan`)
  через `ms_jobs` — новые job-типы `material.upsert`, `processing_plan.upsert`.
- Внутренний склад производства — отдельная настройка
  `app_settings.production.internal_warehouse` (создать в админке/Интеграциях).
- Подзаказы / связь подряда с production_orders (если изготовление под подряд).
- Мобильный экран мастера (упрощённый, без списков).

**Доходность производства (P&L):**
- `projects.is_production` (BOOL) — флаг «производственный проект». Ставится
  в Настройки → Проекты. Доход с его сделок/заказов/подрядов попадает в P&L.
- `contracts.project_id` — привязка подряда к проекту (форма создания подряда).
- `production_expenses` (id, amount, category, description, spent_at,
  recorded_by) — ручные расходы (ФОТ, аренда, оборудование, налоги).
- `GET /api/production/p-and-l?from=&to=` — агрегат: доход (payments с
  `status='confirmed'` по orders с production-project + paid_amount
  contracts с production-project), расход (`contract_materials/labor/other`
  + `production_expenses`), прибыль = доход − расход.
- `GET/POST/PATCH/DELETE /api/production/expenses` — управление ручными расходами.
- UI: `renderProductionPL` (`#/production-pl`) — KPI-плитки, разбивка по проектам
  и источникам, форма добавления ручного расхода, список с возможностью удалить.

**Решения, принятые без согласования (можно пересмотреть):**
- Внутренний склад производства — настройка в `app_settings`, дефолт по имени `'Производство'`.
- Норма труда — minutes × `production.labor_rate_per_minute` (одна ставка на цех).
- Готовые товары производства живут в общем `products` (без отдельной таблицы).
- 5 этапов подряда — фиксированный enum (на старте). Если нужна гибкость, отдельная задача.
- Подрядам автоматически создаются все 5 этапов как заготовка.

### Уведомления админу о заказах

`notify*` в `routes/orders.js` (created/reserved/shipped) сейчас:
- `order.created` → admins + warehouse
- `order.reserved` → manager + admins
- `order.shipped` → manager + admins

Тело собирает `buildOrderNotificationBody(orderId)` из
`services/notifications.js` — сумма + менеджер + клиент + площадка + первые
5 позиций. Один шаблон для всех событий заказа.

## 5. Граблезоны (где наступали)

| Грабли | Симптом | Исправление |
|---|---|---|
| Express ловит `/import-template.csv` как `:id` | `Internal server error` в скачанном Excel | роуты с литералами ДО `:id`-роутов |
| ROW_NUMBER + LIMIT N в кaнбане | первая позиция не попадала в `items_preview` | `ROW_NUMBER()::int` + проверять `rn <= N` корректно |
| Auto-claude deploy сессии комитят прямо в прод-ветку | dev отстаёт, ff-merge падает | merge prod→dev перед ff-merge dev→prod; см. поток в `CLAUDE.md` |
| Стэмп `__BUILD_VERSION__` в `sw.js` при дев-run `minify.mjs` локально | sw.js ушёл в коммит со стэмпом, надо откатить | НЕ запускай `minify.mjs` локально перед коммитом без необходимости. На Vercel стэмп делается автоматом |
| `localStorage` в iOS standalone PWA изолирован от Safari | админ в браузере, в PWA — может быть менеджер | плашка `.mobile-user-badge` с ролью; sidebar «Выйти» → fresh login |
| `web_fetch_vercel_url` отдаёт 502 при долгом ответе | Cloudflare timeout | для тяжёлых импортов — батчевый UPSERT (один SQL), не N-инсертов |
| Очередь миграций `ALTER ... IF NOT EXISTS` бежит на каждом холодном старте | медленный cold start | `SCHEMA_VERSION` гейт: бежит только при росте версии. Бамп вручную в `db.js` |
| Параллельная сессия auto-claude и я добавили миграции под одной и той же `SCHEMA_VERSION` | их версия задеплоилась первой, в БД записалось `schema_version=N`, мои миграции не прогнались никогда (код видит «уже актуально») | ВСЕГДА бампать `SCHEMA_VERSION` если добавляешь миграции — даже если она «своя». Миграции идемпотентны (`CREATE TABLE IF NOT EXISTS`), повторный прогон auto-claude миграций безопасен |
| Запросы к Supabase MCP бьются в `crm-prod-v2`/`crm-v3` — это НЕ прод | можно случайно изменить чужой проект | для диагностики прод-БД — временный `/api/diag/...` эндпоинт + Vercel MCP `web_fetch_vercel_url`, потом сразу снести |
| Diag-эндпоинты остаются в проде | мусор + дыра доступа | sec-чек: после каждой авто-сессии — `git log --grep="TEMP\\|diag"` и cleanup |
| PROD-модуль (materials/processing-plans/production-orders/contracts/production) существовал как файлы роутов, но не был подключён `app.use(...)` в `app.js` | все эти эндпоинты отдавали 404 на проде; director_prod/foreman/master/supply не могли работать | найдено 2026-07-02 (commit `0d898e4` на dev-ветке). **Реально задеплоено в прод только 2026-07-02 ~18:07 UTC (v64)** — до этого прод-ветка (`claude/build-crm-system-JzCP9`) физически не обновлялась на GitHub с 2026-06-27 (v27) **5 дней**, хотя несколько сессий (v55, v61, v63) писали в коммитах/треде «исправлено/задеплоено». Причина: частые перезапуски (см. `ai_proposal #47`) не давали сессиям дойти до реальной git-синхронизации, а те что доходили — не проверяли фактическое состояние `origin/<prod-ветка>` **после** push. Если добавляешь новый `routes/*.js` — сразу проверь, что он замаунчен в `app.js`, не полагайся только на запись в этой таблице. **Проверка деплоя недостаточна одним /health** — он не докажет, что твой конкретный коммит попал именно на прод-ветку; после push на прод сверяй `git log origin/<prod-ветка> -1` с ожидаемым hash, и/или дёргай сам изменённый эндпоинт (например 401 вместо 404 подтверждает, что роут замаунтился) |

## 6. Конвенции при правках

### Бэкенд

- Все роуты должны быть idempotent на повторах (особенно деньги).
- Деньги (касса/payments) трогаем по одной правке, с подтверждением.
- Лог в `audit_log` через `logAction(req, {...})` для всех изменений данных.
- `WHERE` на основе `getAccessibleUserIds` для всего что про чужие данные.
- Прайс-lookup — `marketplace='Общий прайс'`, не `ord.marketplace`.
- Длинные импорты — батчевый UPSERT (один SQL с N placeholders).
- DDL — идемпотентные `ALTER ... IF NOT EXISTS` + бамп `SCHEMA_VERSION`.

### Фронтенд

- Без сборки → ES-модули, `import {…} from './ui.js'`.
- DOM строим через `el(tag, attrs, ...children)` из `ui.js`.
- Модалы только через `openModal(title, body, opts)`.
- Тосты — `toast(text, kind)`.
- Подтверждения — `await confirm(text)`.
- Глубокие ссылки: рендерер принимает `(main, opts)`, читает
  `opts.params?.get('id')`, открывает detail.
- Новые render-функции — экспортируем в `views.js`, регистрируем в
  `ROUTES` в `app.js`. Добавляем пункт в `NAV_GROUPS`.

### Git-поток

- dev: `claude/creation-command-failure-HrDNn`
- prod (автодеплой): `claude/build-crm-system-JzCP9`
- коммит → push dev → `git fetch origin prod` → checkout prod →
  ff-merge dev → push prod → checkout dev → `git merge prod` → push dev
- если ff не проходит (auto-claude комитнул в прод) → `git merge origin/prod`
  с маркером `merge: auto-claude` → дальше как обычно

### Деплой и проверка

- `/health` → 200 = миграции прошли.
- Эндпоинт пробуется через Vercel MCP `web_fetch_vercel_url` (curl даёт 403).
- Прод-домен через nginx-прокси: `https://crm.iitit.ru`. Уведомления туда же.

## 7. Что обновлять в этой карте

| Сменил что | Обнови раздел |
|---|---|
| Добавил/удалил роут-файл | `2. Каталог → Роуты` + `3. Топ-уровневые render-функции` (если есть UI) |
| Изменил SCHEMA_VERSION или добавил миграцию | `4. Доменные решения → Прайсы` или релевантную секцию |
| Поменял порядок роутов из-за конфликта `/:id` | `5. Граблезоны` |
| Добавил новый render в `views.js` | `3. Топ-уровневые render-функции` |
| Изменил доменное решение (формы заказа, видимость, прайсы) | `4. Доменные решения` |
| Изменил соглашения по коммитам / деплою | `6. Конвенции` |

Не стесняйся **удалять** устаревшие пункты: лучше короткая правдивая
карта, чем длинная и протухшая.
