# ТЗ для v0.dev — редизайн CRM «Прямые продажи»

Этот документ — бриф для генерации UI через **v0 by Vercel** (https://v0.dev). Каждый раздел можно вставить как отдельный промпт в v0 — он сгенерирует React+Tailwind компоненты, которые потом перенесём в наш vanilla-JS проект (или мигрируем стек на Next.js, если решим).

---

## 0. Контекст продукта (используется как «system» для v0)

Это **CRM для прямых продаж через маркетплейсы и собственные сайты**. Команда: админ, менеджеры, продажники, склад. Основные сущности:

- **Сделки** (классическая воронка: new → qualified → proposal → negotiation → won/lost)
- **Лиды / Контакты / Компании** (база клиентов)
- **Заказы** из площадок (Wildberries, Ozon, Avito, Яндекс.Маркет, лендинги) — статусы: new → reserved → shipped → completed/cancelled
- **Каталог товаров** с себестоимостью и прайсами по площадкам
- **Касса** менеджера с подтверждением платежей админом
- **Интеграции**: API-токены, исходящие вебхуки, embed-формы для лендингов, Telegram-боты

Tone: **деловой, дружелюбный, не корпоративный**. Цель — менеджер с среднестатистическим компом должен с первого взгляда понимать что делать. По возможности — drag-and-drop, превью картинок, минимум модалок.

Целевой стек: **React + Next.js (app router) + Tailwind + shadcn/ui**. Цвета через CSS-переменные, можно темная тема в будущем.

Поддерживаемые языки UI: русский (основной), английский (опционально).

---

## 1. Дизайн-система (создать первым делом)

> **Промпт v0:**
> Build a design system foundation for a Russian-language CRM dashboard. Include:
> - Color palette: primary `#2563eb` (royal blue), success `#16a34a`, warning `#d97706`, danger `#dc2626`, neutral grays from `#f4f5f7` (bg) to `#1f2328` (text). Sidebar dark `#111827`.
> - Typography: SF Pro / Inter / system stack. Sizes: 22px page title, 16px section, 14px body, 12px meta, 11px badges.
> - Spacing: 4px / 8px / 12px / 16px / 24px scale.
> - Border radius: 6px small, 8px cards, 999px badges.
> - Status badges: new (blue), reserved/proposal (amber), shipped/negotiation (orange), completed/won (green), cancelled/lost (red), pending (yellow).
> - Components: Button (primary, secondary, danger, ghost, small variants), Input, Select, Textarea, Checkbox, Modal, Toast, Empty State, Card, Avatar, Badge, Tooltip, Tabs, Dropdown, Kbd (для Ctrl+K).
> - All components should support a hover state and a focus ring. Mobile-friendly down to 360px.
> - Output: shadcn/ui-compatible components in `components/ui/`.

---

## 2. Layout оболочки (shell)

> **Промпт v0:**
> Design a CRM application shell with:
> - **Left sidebar** (220px wide, collapsible to icon-only on small screens, dark `#111827` bg):
>   - Logo/brand on top (just text "CRM" for now)
>   - **Global search button** with `🔍 Поиск` label and `Ctrl K` keyboard shortcut badge on the right (opens a command palette)
>   - **Notification bell** with `🔔 Уведомления` and red counter badge for unread
>   - Navigation links (active item has a left blue accent bar and lighter bg):
>     - Дашборд / Воронка / Сделки / Лиды / Контакты / Компании / Задачи
>     - Прямые продажи / Каталог / Касса
>     - Пользователи / Приглашения / Интеграции (admin only)
>   - User block at bottom: avatar, name, email, role, logout button
> - **Main content area** scrollable, 24px padding
> - **Toast container** top-right (stacked notifications, auto-dismiss 3.5s)
> - **Modal root** with backdrop blur
> 
> Use icons from lucide-react.
> Make the sidebar position fixed; main scrolls independently.

---

## 3. Дашборд

> **Промпт v0:**
> Design a CRM dashboard page with:
> - **Greeting card** at the top (gradient blue background): time-of-day greeting ("Доброе утро, Мария!") + a role-specific tip in smaller text below.
> - **"Сегодня" card**: bulleted list of actionable items (overdue tasks count with warning icon, upcoming tasks, expected revenue from weighted pipeline, empty-state "Срочных дел нет ✨").
> - **4-column stat grid**: total companies, contacts, leads, deals (each as a card with uppercase label, big number, optional sub-text).
> - **4-column stat grid**: pipeline value, weighted pipeline, conversion rate (with won/lost split), tasks (with overdue count).
> - **Two horizontal bar charts side-by-side**: "Лиды по статусу" and "Сделки по стадии" — horizontal bars filled with primary color, labels on left, count on right.
> - Optionally: a 7-day mini-chart of new orders count.
> 
> Mobile: stack to single column. Use shadcn/ui Card + Tailwind grid.

---

## 4. Воронка сделок (kanban с drag-and-drop)

> **Промпт v0:**
> Design a sales pipeline kanban board with **drag-and-drop**:
> - **6 columns** in a horizontal grid: «Новая» / «Квалифицирована» / «Предложение» / «Переговоры» / «Выиграна» / «Проиграна». Each column has a header showing stage name, deal count, and total amount.
> - Cards are **draggable** between columns. While dragging, original card is semi-transparent. Drop targets show a dashed blue outline.
> - **Card content**: deal title (bold), amount + probability badge, company name with avatar, expected close date with calendar icon.
> - When user drops into "Выиграна" — show a confetti animation. Into "Проиграна" — open a small "Reason" prompt.
> - Use react-beautiful-dnd or @dnd-kit/core.
> - Empty columns show a dashed placeholder "Пусто".
> - Above the columns: a friendly hint banner — "💡 Перетаскивайте карточки между колонками, чтобы менять стадию".
> - Below: a summary bar — "Сумма воронки: X · Взвешенная: Y".
> - On mobile: stacked single-column view with horizontal scroll between columns.

---

## 5. Прямые продажи: список + канбан

> **Промпт v0:**
> Design an orders management page with two view modes:
> 
> **View toggle in toolbar**: «☰ Список» / «▦ Канбан» (sticky toggle).
> 
> **Filters bar**: search input (debounced), status filter, marketplace filter, "+Новый заказ" CTA.
> 
> **List view**: dense data table with sortable columns:
> - № / Площадка / Внеш. № / Клиент / Сумма / Поз. / Статус (colored badge) / Менеджер / Создан / Действия (Резервировать / Отгрузить / Завершить / Отменить — buttons depending on status and user role).
> 
> **Kanban view**: 5 columns (Новый / Зарезервирован / Отгружен / Завершён / Отменён). Each card shows:
> - **First product image as thumbnail** (40x40 square, top-left).
> - Order #ID and client name on the right of thumbnail.
> - Amount + marketplace + reference number + manager name.
> Allow drag between adjacent statuses only (with backend validation: warehouse can do new→reserved→shipped, manager can do shipped→completed, anyone with access can cancel).
> 
> Above kanban: contextual hint about allowed transitions for current user's role.
> 
> Order detail modal: shows everything + a **product items table with thumbnails**. If a line's unit_price differs from catalog_price, show "📝 прайс: 1500 ₽" in amber under the price.

---

## 6. Каталог товаров

> **Промпт v0:**
> Design a product catalog page with:
> - **Grid of product cards** (4 per row on desktop, 2 on tablet, 1 on mobile):
>   - 140px-tall image (or 📦 placeholder if no image)
>   - Product name (2-line clamp)
>   - SKU subtitle, optional badge "moysklad" if synced
>   - Bottom strip: "Себестоимость 500 ₽" (muted) + "3 прайса" link in primary color (or "нет прайсов" in amber)
>   - Hover lifts card slightly
> - **Toolbar**: search input, "⬇ Импорт из МойСклад" (admin), "+ Новый товар" CTA
> - **Help banner**: "💡 Прайс по площадке = цена этого товара для конкретного маркетплейса/лендинга. При создании заказа подставляется автоматически."
> - **Product editor modal**: name, SKU, image URL with live preview thumbnail (120x120), cost price, unit, active toggle, description, plus a **Prices section**:
>   - List of existing prices (marketplace name + price + delete button)
>   - Add row: marketplace select + price input + "+Добавить" button
> - **МойСклад import modal**: token input (password type), brief explanation, "Начать импорт" button, progress status. On success: "✅ Готово: создано N, обновлено M, всего K".

---

## 7. Создание заказа с пикером товаров

> **Промпт v0:**
> Design an "Order create/edit" modal form:
> 
> Top section: 2-column grid — Reference #, Marketplace (select with options Wildberries/Ozon/Яндекс.Маркет/Avito/Другое), Client classification, Client name, Currency, Notes (textarea).
> 
> **Items section** below: table with these columns:
> | thumbnail (40x40) | SKU + 📦-button | name | qty | price | × |
> 
> The **📦-button next to SKU** opens a **product picker modal**:
> - Top: search input with marketplace tag chip (e.g. "Wildberries") and a close X
> - Body: scrollable list of products. Each row: 48x48 thumbnail (or 📦 if no image) | name + SKU + cost price (muted) | marketplace-specific price in bold blue right-aligned (or "нет в прайсе" in amber if no price for current marketplace)
> - On row click → fill the order item line with name, SKU, image, AND price from this marketplace
> 
> **Price field behavior**: if `unit_price !== catalog_price`, show a small inline hint:
> - "📝 изменено · прайс: 1500 ₽" (amber, italic) when changed manually
> - "прайс: 1500 ₽" (green) when matches catalog
> 
> Marketplace select change → re-fetch catalog prices for all already-picked items, update the "catalog_price" reference but don't touch the user's unit_price. This way the user sees "📝 изменено" if they kept the old price after switching marketplace.
> 
> Below table: "Итого: X ₽" right-aligned in bold.
> Add row button: "+ Добавить позицию".

---

## 8. Глобальный поиск (Command Palette)

> **Промпт v0:**
> Design a command-palette-style global search modal triggered by Ctrl+K:
> - Centered modal, ~640px wide, max 70vh tall
> - **Big search input** at top with autofocus
> - Help line: "Esc — закрыть · ↑↓ — навигация · Enter — открыть"
> - **Results grouped** by entity type with section headers:
>   - 🌱 Лиды
>   - 👥 Контакты
>   - 🏢 Компании
>   - 💼 Сделки
>   - 📦 Заказы
> - Each result row: relevant fields (e.g. for a lead: name + email/phone; for a deal: title + amount)
> - Empty state: "Введите минимум 2 символа…" or "Ничего не найдено"
> - Arrow keys navigate, Enter opens, Esc closes, click outside closes
> - Backdrop blur

---

## 9. Уведомления (bell dropdown + toasts)

> **Промпт v0:**
> Design two notification UIs:
> 
> **A. Bell dropdown** — when user clicks the sidebar bell:
> - Anchored panel ~340px wide, max 480px tall, scrollable
> - Header: "Уведомления" title + "Прочитать все" link (when there are unread)
> - List items: notification icon by type, title (bold), body (muted), time-ago — clicking navigates to link
> - Unread items have a blue left border or light-blue bg tint
> - Empty state: "Уведомлений нет"
> 
> **B. Toast** for incoming real-time notifications:
> - Top-right corner, stacks
> - Variants: success (green), error (red), info (default dark)
> - Title + body, auto-dismiss in 3.5s with hover-pause
> - Slide-in from right, slide-out to right
> 
> Backed by polling every 20s (or SSE if available).

---

## 10. Страница «Интеграции»

> **Промпт v0:**
> Design an "Integrations" admin page with three sections:
> 
> **A. API tokens table**: name, prefix `crm_abc…xyz`, scopes (chips), last used at, created at, status (Active/Revoked badge), actions (Revoke or Delete).
> 
> Create-token modal: name input, checkboxes for scopes (leads:create, orders:create). After creation — **show the raw token ONCE** in a dark code block with a big "Скопировать" button, with a warning "это значение больше нигде не будет показано".
> 
> **B. Webhooks table**: name, URL (monospaced, truncated), events (comma-separated), deliveries count, last delivery status (with HTTP code), Active toggle, Edit/Delete.
> 
> Create-webhook modal: name, URL, events select (presets: "Все", "Заказы", "Платежи"), optional HMAC secret.
> 
> **C. Documentation cards** (2-column grid):
> - 🌐 Свой лендинг / сайт — with copy-pastable `<script src="..." data-token="...">` snippet
> - 📥 Прямой вызов API — with `curl` / fetch example
> - 🤖 Telegram-бот — link to example file
> - 📡 Webhook на ваши системы — explanation
> 
> Use shadcn/ui Tabs to switch between A/B/C sections, or stack vertically.

---

## 11. Касса

> **Промпт v0:**
> Design a cashbox page for the sales manager role:
> - **Big gradient balance card** at top (blue gradient): "Баланс: 28 000 ₽" big number, with "Подтверждено: 28 000 ₽ · На подтверждении: 1 350 ₽" subtext
> - **Add payment** button on right of header
> - **Payments table**: дата / сумма / метод (Наличные / Карта / Банк. перевод / Другое) / номер транзакции / статус (badge) / привязан к заказу #N / действия (Подтвердить/Отклонить for admin)
> - Admin can switch managers via a dropdown in toolbar
> - Sales user sees only their own
> 
> Filter: status (pending / confirmed / rejected).

---

## 12. Embed-форма для лендинга

> **Промпт v0:**
> Design a clean, minimal contact form that can be embedded on third-party landing pages via a one-line `<script>`. The form lives inside a small Card (max 420px wide):
> - Heading: "Оставить заявку"
> - Fields: Имя (required), Телефон, Email, Сообщение (textarea)
> - Submit button: "Отправить заявку" (primary, full width)
> - Success state: green success card "✅ Спасибо! Менеджер свяжется с вами."
> - Error state: red card "❌ Не удалось отправить"
> - Field labels above inputs, no placeholders inside fields (cleaner look)
> - Inherit body font from parent page

---

## 13. Тур по интерфейсу (onboarding)

> **Промпт v0:**
> Design an interactive product tour overlay shown on first login:
> - Semi-transparent backdrop with a "spotlight" cut-out around the highlighted element
> - Tooltip popup near the spotlight with: step counter "1/5", title, 1-2 sentence description, "Назад" / "Далее" / "Пропустить" buttons
> - Steps (different for each role):
>   - **Manager**: 1) приветствие на дашборде, 2) воронка с drag-and-drop, 3) глобальный поиск Ctrl+K, 4) уведомления, 5) каталог
>   - **Warehouse**: 1) приветствие, 2) канбан заказов с drag-drop по статусам, 3) уведомления о новых заказах
>   - **Admin**: 1) приветствие, 2) интеграции / токены, 3) пользователи + приглашения, 4) подтверждение платежей в кассе
> - Skip button always visible top-right; tour state stored in localStorage

---

## 14. Mobile views

> **Промпт v0:**
> Adapt the CRM for mobile (≤640px):
> - Sidebar collapses into a top hamburger menu with slide-out drawer
> - Search/bell move into the top bar
> - Tables become card-based lists
> - Kanban becomes a horizontal-scrolling row of columns (one column visible at a time, snap-to)
> - Forms full-width, no two-column grids
> - Bottom navigation bar with 4 main destinations: Дашборд / Сделки / Заказы / Меню

---

## Финальный совет по работе с v0

1. **Не лей всё одним промптом.** v0 лучше работает с отдельными запросами по 1-2 экранам.
2. **Дай скриншоты текущей версии** — v0 умеет в режим «улучши этот скрин».
3. **Закрепи design system** первым — потом во всех остальных промптах ссылайся на «previous design system» в текущем чате v0.
4. **Финальные компоненты** v0 экспортирует как `tsx` файлы — переносить в наш vanilla-JS проект придётся либо ручной адаптацией, либо мигрируя стек на Next.js (что вообще-то рекомендую для дальнейшего развития).

---

## Что мигрировать первым (если оставлять vanilla-JS)

Если решим **не** переписывать всё на Next.js, можно взять у v0 только CSS и разметку:
1. Дизайн-система (CSS-переменные + базовые компоненты) → подменить наш `styles.css`
2. Канбан-доска → подправить классы и стили в наших `renderPipelineBody` / `renderOrdersKanban`
3. Дашборд → переписать `renderDashboard` с новыми классами

Если **переписываем на Next.js**:
1. Поднимаем Next.js проект, подключаем shadcn/ui
2. Бэкенд (всё что в `src/`) переносим в `app/api/` route handlers (схема БД, auth, бизнес-логика — копируем 1-к-1)
3. Фронтенд (`public/js/*`) выкидываем, переписываем как RSC + client components
4. Авторизация через cookie-based сессии или next-auth
