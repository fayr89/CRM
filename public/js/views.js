import { api } from './api.js';
import {
  T,
  badge,
  buildForm,
  clear,
  confirm,
  el,
  emptyState,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  greeting,
  helpBanner,
  openModal,
  paginator,
  toast,
  tr,
} from './ui.js';
import { subscribeToPush, unsubscribeFromPush, getPushLocalStatus, sendTestPush, ensureServerHasSubscription } from './push.js';

// Безопасно отображать пользовательский текст с HTML разметкой
function safeHtml(plainText, htmlParts = {}) {
  let result = plainText;
  for (const [key, value] of Object.entries(htmlParts)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  return result.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// Подробные инструкции по разделам (простым языком). Открываются кнопкой «📖 Инструкция».
const INSTRUCTIONS = {
  orders: {
    title: 'Как работать с прямыми продажами',
    steps: [
      'Нажмите «Новый заказ».',
      'Выберите площадку (Avito, Ozon и т.д.) и классификацию клиента: B2C — физлицо (по умолчанию), B2B — компания.',
      'Для B2B обязательно укажите имя и телефон клиента — он автоматически попадёт в базу контактов и закрепится за вами.',
      'Если площадка Avito — вставьте ссылку на диалог с клиентом и приложите QR-код отправления (можно загрузить скрин с телефона).',
      'Выберите способ оплаты и способ отправки.',
      'Добавьте товары: начните вводить название/артикул или нажмите «Каталог». Цена подставится из прайса.',
      'Если сумма заказа достигла порога — появится плашка со скидкой. Нажмите «Применить скидку», чтобы снизить цены.',
      'Нажмите «Создать». Когда заказ готов к сборке — переведите его в статус «Зарезервирован».',
      'При резерве заказ уходит на склад (раздел «Отгрузки») и сумма попадает в кассу на подтверждение.',
      'Внимание: для Avito-доставки без QR-кода зарезервировать заказ нельзя.',
    ],
  },
  kanban: {
    title: 'Памятка по статусам и канбану',
    steps: [
      'СТАТУСЫ (слева направо в канбане):',
      '⏳ «Ожидает товара» — заказ принят, но товара нет на складе. Резерв не создан, в кассу ничего не попало. Закрывается, когда товар придёт или клиент откажется.',
      '🆕 «Новый» — товар на складе, заказ готов к резерву. Менеджер может править состав/цены.',
      '🔒 «Зарезервирован» — товар забронирован за заказом, склад готовит к отгрузке. В кассе появился приход на сумму заказа (на подтверждении).',
      '🚚 «Отгружен» — товар отправлен клиенту.',
      '✅ «Завершён» — заказ закрыт.',
      '❌ «Отменён» — закрыт без отгрузки или с отменой после неё.',

      'ДВИЖЕНИЕ ПО КАНБАНУ (drag-and-drop) — допустимые переходы:',
      '«Новый» → «Зарезервирован»: менеджер. Обязателен «Номер отправления». Создаётся приход в кассе.',
      '«Новый» ↔ «Ожидает товара»: менеджер. Просто смена статуса, без касса/возвратов.',
      '«Ожидает товара» → «Новый» (кнопка «✅ Товар поступил»): любая роль с доступом.',
      '«Зарезервирован» → «Ожидает товара» (кнопка «⏳ Ждём товара»): только склад/админ. Используется когда товар не нашли при сборке.',
      '«Зарезервирован» → «Отгружен»: только склад/админ.',
      '«Отгружен» → «Зарезервирован» (кнопка «↩️ Вернуть в к отгрузке»): только склад/админ. Откат ошибочной отгрузки.',
      '«Отгружен» → «Завершён»: автоматически или вручную.',
      'В «Отменён» можно перейти из любого активного статуса (с указанием причины).',

      'ПРАВИЛА ОТМЕНЫ:',
      'Из «Новый» или «Ожидает товара» — без возврата (товар не списывался). Если в кассе был приход — создаётся компенсирующий расход.',
      'Из «Зарезервирован» или «Отгружен» — заказ уходит в «Возвраты» к складу. Склад обрабатывает физический возврат (вернуть в сток / списать как потерянный).',
      'Менеджер может отменить заказ в любом активном статусе, включая отгруженный (клиент отказался после отгрузки). Склад и админ — также.',
      'На отменённом заказе сохраняется «из какого статуса отменили» — для статистики причин «отказ до поступления» / «не оплатил» / «отказался после отгрузки».',

      'ЧАСТИЧНЫЕ ДЕЙСТВИЯ (≥ 2 шт товара суммарно в заказе):',
      'В деталях заказа у каждой позиции есть кнопки ⏳ и 🚫.',
      '⏳ «Ждём товара по позиции» — отделяет позицию или её часть (с указанием количества) в НОВЫЙ заказ «Ожидает товара». Исходный продолжает идти на отгрузку.',
      '🚫 «Отменить позицию» — отделяет позицию (можно часть) и сразу отменяет её с причиной. Если исходный был «Зарезервирован», новая часть уходит в «Возвраты».',
      'Кнопка «✂️ Разделить заказ» в деталях — открывает диалог, где можно отметить сразу несколько позиций с указанием количеств. Новый заказ — «Новый» или «Ожидает товара» на выбор.',
      'Сами «разделённые» заказы видно на канбане по бейджу «🔀 из #N» (новый кусок) или «🔀 разделён» (исходный).',

      'ТИПОВЫЕ СЦЕНАРИИ:',
      'Клиент не оплатил — менеджер отменяет с причиной «Не оплачен». Если «Новый» — без возврата; если «Зарезервирован» — склад вернёт товар в сток через «Возвраты».',
      'Клиент отказался после отгрузки — менеджер переводит в «Отменён» с причиной, заказ попадает в «Возвраты» (физически клиент должен вернуть товар).',
      'Часть товара отсутствует на складе — склад в деталях заказа жмёт ⏳ на нужной позиции → новый заказ «Ожидает товара», исходный идёт на отгрузку с оставшимися позициями.',
      'Ошибочно отгрузили — склад/админ открывает заказ и жмёт «↩️ Вернуть в к отгрузке».',
      'Клиент заказал 2 шт, а на складе только 1 — открыть заказ, на позиции ⏳ → указать «1 шт» → 1 шт уйдёт в «Ожидает товара», 1 шт останется в исходном заказе и отгрузится.',
    ],
  },
  shipping: {
    title: 'Как отгружать заказы (роль «Склад»)',
    steps: [
      'Все заказы в статусе «Зарезервирован» собираются внизу страницы «Отгрузки».',
      'Настройте дни и время отсечки отгрузок (если вы склад/админ).',
      'Нажмите «⬇ Выгрузить в Excel» — получите файл со всеми заказами, количеством и QR-кодами.',
      'Соберите товары. Отметьте галочками нужные заказы и нажмите «Отгрузить выбранные» (или «Отгрузить все»).',
      'Заказы перейдут в статус «Отгружен», а менеджеры получат уведомление.',
      'В колонке QR значок «✗ нет!» означает Avito-доставку без QR-кода — такой заказ требует QR.',
    ],
  },
  cashbox: {
    title: 'Как работать с кассой',
    steps: [
      'Приход по заказу появляется автоматически, когда заказ переводят в «Зарезервирован».',
      'Отмена заказа создаёт компенсирующий расход — оборот по нему обнуляется.',
      'Менеджер может проставить комиссию площадки прямо в строке транзакции.',
      'Ручную транзакцию (приход или расход) добавьте кнопкой «Добавить транзакцию».',
      'Финансовый управляющий или админ проверяет транзакцию и нажимает «Подтвердить» или «Отклонить».',
      'Баланс показан двумя суммами: подтверждённый (зелёный) и ожидающий подтверждения (оранжевый).',
      'Итоговый баланс = приход − расход − комиссия по подтверждённым транзакциям.',
    ],
  },
  products: {
    title: 'Как работать с каталогом',
    steps: [
      'Товары и остатки подтягиваются из МойСклад. Сначала сохраните токен в «Настройки → Токен МойСклад» (один раз).',
      '«Импорт из МойСклад» — загружает товары и поставщиков. «🔄 Остатки» — обновляет остатки. «🏬 Склады» — остатки по складам.',
      'Фильтры сверху: по складу, поставщику, наличию остатков.',
      'В строке товара видно остаток, резерв и склады. «Канал: цена» — цена товара по площадкам из прайса.',
      '«Шаблон прайса» → заполните цены в Excel → «Загрузить прайс». «Правила цен» — проценты по оплате и пороги скидок по сумме.',
    ],
  },
  integrations: {
    title: 'Настройки',
    steps: [
      '«🔑 Токен МойСклад» — сохраните Bearer-токен один раз, он хранится шифрованно. После этого импорт не будет просить токен.',
      '«🛒 Площадки» — добавьте/удалите площадки продаж (появятся в форме заказа и прайсах).',
      '«🚚 Способы доставки» — список для поля «Способ отправки» в заказе.',
      '«🏬 Видимость складов» — какие склады показывать и учитывать в остатке.',
      'API-токены и вебхуки — для подключения внешних сайтов и ботов.',
    ],
  },
  returns: {
    title: 'Как работать с возвратами',
    steps: [
      'Сюда попадают заказы, которые отменили.',
      'По каждому возврату склад решает: вернуть товар в сток (если годен) или списать (если не годен).',
      'При списании приложите пруф (фото) — подтверждение, что товар негоден.',
      'После обработки возврат закрывается.',
    ],
  },
};

function helpButton(sectionKey) {
  const info = INSTRUCTIONS[sectionKey];
  if (!info) return null;
  return el(
    'button',
    {
      class: 'btn btn-ghost help-btn',
      title: 'Инструкция',
      onClick: () => {
        const body = el(
          'div',
          { class: 'help-modal' },
          el('ol', { class: 'help-steps' }, ...info.steps.map((s) => el('li', {}, s))),
        );
        openModal(`📖 ${info.title}`, body, { primaryLabel: null });
      },
    },
    '📖 Инструкция',
  );
}

let CACHE = { users: [], companies: [], contacts: [], projects: [] };

async function loadLookups() {
  try {
    const [users, companies, contacts, projects] = await Promise.all([
      api.list('users', { limit: 200 }).catch(() => ({ data: [] })),
      api.list('companies', { limit: 200 }),
      api.list('contacts', { limit: 200 }),
      api.projectsList(true).catch(() => ({ data: [] })),
    ]);
    CACHE.users = users.data || [];
    CACHE.companies = companies.data || [];
    CACHE.contacts = contacts.data || [];
    CACHE.projects = projects.data || [];
  } catch (e) {
    console.warn('Не удалось загрузить справочники', e);
  }
}

function userName(id) {
  const u = CACHE.users.find((x) => x.id === id);
  return u ? u.name : '—';
}

function companyName(id) {
  if (!id) return '—';
  const c = CACHE.companies.find((x) => x.id === id);
  return c ? c.name : `#${id}`;
}

function projectOptions() {
  return [
    { value: '', label: '— без проекта —' },
    ...CACHE.projects.map((p) => ({ value: p.id, label: p.name })),
  ];
}

// Рисует «стикер проекта» — цветной тег с именем. Если color/name нет — null.
function projectSticker(row) {
  if (!row.project_id || !row.project_name) return null;
  return el('span', {
    class: 'project-sticker',
    style: { background: row.project_color || '#6366f1' },
    title: 'Проект',
  }, row.project_name);
}

// --- Опции для select из переводов ---
const optsFromT = (category) => [
  { value: '', label: '—' },
  ...Object.entries(T[category]).map(([value, label]) => ({ value, label })),
];

const RESOURCES = {
  companies: {
    title: 'Компании',
    singular: 'компанию',
    newLabel: 'Новая компания',
    editLabel: 'Редактировать компанию',
    deleteLabel: 'Удалить компанию?',
    columns: [
      { key: 'name', label: 'Название', render: (r) => {
        const sticker = projectSticker(r);
        return sticker
          ? el('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, r.name, sticker)
          : r.name;
      } },
      { key: 'industry', label: 'Отрасль' },
      { key: 'size', label: 'Размер', render: (r) => (r.size ? tr('size', r.size) : '—') },
      { key: 'annual_revenue', label: 'Выручка', render: (r) => fmtMoney(r.annual_revenue) },
      { key: 'owner_id', label: 'Ответственный', render: (r) => userName(r.owner_id) },
      { key: 'created_at', label: 'Создана', render: (r) => fmtDate(r.created_at) },
    ],
    filters: [
      { key: 'size', type: 'select', options: optsFromT('size'), label: 'Размер' },
      { key: 'industry', type: 'text', label: 'Отрасль' },
      { key: 'project_id', type: 'select', options: projectOptions, label: 'Проект', numeric: true },
    ],
    form: () => [
      { name: 'name', label: 'Название', required: true },
      { name: 'project_id', label: 'Проект', type: 'select', numeric: true, options: projectOptions() },
      { name: 'industry', label: 'Отрасль' },
      { name: 'website', label: 'Сайт' },
      { name: 'email', label: 'Email' },
      { name: 'phone', label: 'Телефон' },
      { name: 'size', label: 'Размер', type: 'select', options: optsFromT('size') },
      { name: 'annual_revenue', label: 'Годовая выручка', type: 'number' },
      {
        name: 'owner_id',
        label: 'Ответственный',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      { name: 'address', label: 'Адрес', type: 'textarea' },
      { name: 'description', label: 'Описание', type: 'textarea' },
    ],
  },
  contacts: {
    title: 'Контакты',
    singular: 'контакт',
    newLabel: 'Новый контакт',
    editLabel: 'Редактировать контакт',
    deleteLabel: 'Удалить контакт?',
    columns: [
      {
        key: 'name',
        label: 'Имя',
        render: (r) => {
          const name = `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`;
          const sticker = projectSticker(r);
          return sticker
            ? el('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, name, sticker)
            : name;
        },
      },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Телефон' },
      { key: 'position', label: 'Должность' },
      { key: 'company', label: 'Компания', render: (r) => r.company_name || companyName(r.company_id) },
      { key: 'owner', label: 'Ответственный', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'project_id', type: 'select', options: projectOptions, label: 'Проект', numeric: true },
    ],
    form: () => [
      { name: 'first_name', label: 'Имя', required: true },
      { name: 'last_name', label: 'Фамилия' },
      { name: 'project_id', label: 'Проект', type: 'select', numeric: true, options: projectOptions() },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Телефон' },
      { name: 'position', label: 'Должность' },
      {
        name: 'company_id',
        label: 'Компания',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.companies.map((c) => ({ value: c.id, label: c.name })),
        ],
      },
      {
        name: 'owner_id',
        label: 'Ответственный',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      { name: 'notes', label: 'Заметки', type: 'textarea' },
    ],
  },
  leads: {
    title: 'Лиды',
    singular: 'лид',
    newLabel: 'Новый лид',
    editLabel: 'Редактировать лид',
    deleteLabel: 'Удалить лид?',
    columns: [
      {
        key: 'name',
        label: 'Имя',
        render: (r) => {
          const name = `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`;
          const sticker = projectSticker(r);
          return sticker
            ? el('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, name, sticker)
            : name;
        },
      },
      { key: 'company_name', label: 'Компания' },
      { key: 'email', label: 'Email' },
      { key: 'source', label: 'Источник', render: (r) => (r.source ? tr('source', r.source) : '—') },
      { key: 'status', label: 'Статус', render: (r) => badge(r.status, 'status') },
      { key: 'estimated_value', label: 'Сумма', render: (r) => fmtMoney(r.estimated_value) },
      { key: 'owner', label: 'Ответственный', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'status', type: 'select', options: optsFromT('status'), label: 'Статус' },
      { key: 'source', type: 'select', options: optsFromT('source'), label: 'Источник' },
      { key: 'project_id', type: 'select', options: projectOptions, label: 'Проект', numeric: true },
    ],
    form: () => [
      { name: 'first_name', label: 'Имя', required: true },
      { name: 'last_name', label: 'Фамилия' },
      { name: 'project_id', label: 'Проект', type: 'select', numeric: true, options: projectOptions() },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Телефон' },
      { name: 'company_name', label: 'Компания' },
      { name: 'position', label: 'Должность' },
      { name: 'source', label: 'Источник', type: 'select', options: optsFromT('source') },
      {
        name: 'status',
        label: 'Статус',
        type: 'select',
        options: Object.entries(T.status).map(([v, l]) => ({ value: v, label: l })),
      },
      { name: 'estimated_value', label: 'Оценочная сумма', type: 'number' },
      // --- Блок квалификации лида ---
      { name: 'classification', label: 'B2B/B2C', type: 'select', options: [
        { value: '', label: '— не указано —' },
        { value: 'B2C', label: 'B2C (физлицо)' },
        { value: 'B2B', label: 'B2B (компания)' },
      ] },
      { name: 'purchase_frequency', label: 'Частота закупок', type: 'select', options: [
        { value: '', label: '— не указано —' },
        { value: 'one_time', label: 'Разовый' },
        { value: 'monthly', label: 'Раз в месяц' },
        { value: 'quarterly', label: 'Раз в квартал' },
        { value: 'regular', label: 'Регулярно' },
      ] },
      { name: 'expected_volume', label: 'Ожидаемый объём (₽/мес)', type: 'number' },
      { name: 'buy_readiness', label: 'Готовность купить', type: 'select', options: [
        { value: '', label: '— не указано —' },
        { value: 'now', label: 'Прямо сейчас' },
        { value: 'this_month', label: 'В течение месяца' },
        { value: 'browsing', label: 'Присматривается' },
      ] },
      {
        name: 'owner_id',
        label: 'Ответственный',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      { name: 'description', label: 'Описание', type: 'textarea' },
    ],
    extraActions: (row, reload) => [
      row.status !== 'converted'
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                if (
                  !(await confirm(
                    `Сконвертировать лида "${row.first_name}" в контакт и сделку?`,
                  ))
                )
                  return;
                try {
                  await api.convertLead(row.id);
                  toast('Лид сконвертирован', 'success');
                  reload();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            'Конвертировать',
          )
        : null,
    ],
  },
  deals: {
    title: 'Сделки',
    singular: 'сделку',
    newLabel: 'Новая сделка',
    editLabel: 'Редактировать сделку',
    deleteLabel: 'Удалить сделку?',
    columns: [
      { key: 'title', label: 'Название', render: (r) => {
        const sticker = projectSticker(r);
        return sticker
          ? el('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, r.title, sticker)
          : r.title;
      } },
      { key: 'amount', label: 'Сумма', render: (r) => fmtMoney(r.amount, r.currency) },
      { key: 'stage', label: 'Стадия', render: (r) => badge(r.stage, 'stage') },
      { key: 'probability', label: 'Вер.', render: (r) => `${r.probability}%` },
      { key: 'expected_close_date', label: 'Закрытие', render: (r) => fmtDate(r.expected_close_date) },
      {
        key: 'company',
        label: 'Компания',
        render: (r) => r.company_name || companyName(r.company_id),
      },
      { key: 'owner', label: 'Ответственный', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'stage', type: 'select', options: optsFromT('stage'), label: 'Стадия' },
      { key: 'project_id', type: 'select', options: projectOptions, label: 'Проект', numeric: true },
    ],
    form: () => [
      { name: 'title', label: 'Название', required: true },
      { name: 'project_id', label: 'Проект', type: 'select', numeric: true, options: projectOptions() },
      { name: 'amount', label: 'Сумма', type: 'number', default: 0 },
      { name: 'currency', label: 'Валюта', default: 'RUB' },
      {
        name: 'stage',
        label: 'Стадия',
        type: 'select',
        options: Object.entries(T.stage).map(([v, l]) => ({ value: v, label: l })),
      },
      { name: 'probability', label: 'Вероятность (%)', type: 'number' },
      { name: 'expected_close_date', label: 'Ожидаемая дата закрытия', type: 'date' },
      {
        name: 'company_id',
        label: 'Компания',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.companies.map((c) => ({ value: c.id, label: c.name })),
        ],
      },
      {
        name: 'contact_id',
        label: 'Контакт',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.contacts.map((c) => ({
            value: c.id,
            label: `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}`,
          })),
        ],
      },
      {
        name: 'owner_id',
        label: 'Ответственный',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      { name: 'description', label: 'Описание', type: 'textarea' },
    ],
    extraActions: (row, reload) => [
      !['won', 'lost'].includes(row.stage)
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              style: { color: 'var(--success)' },
              onClick: async (e) => {
                e.stopPropagation();
                if (!(await confirm(`Отметить сделку "${row.title}" как выигранную?`))) return;
                await api.winDeal(row.id);
                toast('Сделка выиграна', 'success');
                reload();
              },
            },
            'Выиграна',
          )
        : null,
      !['won', 'lost'].includes(row.stage)
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              style: { color: 'var(--danger)' },
              onClick: async (e) => {
                e.stopPropagation();
                const reason = prompt('Причина проигрыша (необязательно):') || '';
                await api.loseDeal(row.id, reason);
                toast('Сделка проиграна', 'success');
                reload();
              },
            },
            'Проиграна',
          )
        : null,
    ],
  },
  activities: {
    title: 'Задачи',
    singular: 'задачу',
    newLabel: 'Новая задача',
    editLabel: 'Редактировать задачу',
    deleteLabel: 'Удалить задачу?',
    columns: [
      { key: 'type', label: 'Тип', render: (r) => tr('activity_type', r.type) },
      { key: 'subject', label: 'Тема' },
      { key: 'due_date', label: 'Срок', render: (r) => fmtDateTime(r.due_date) },
      {
        key: 'status',
        label: 'Статус',
        render: (r) => {
          if (r.completed_at)
            return el('span', { class: 'badge won' }, 'Выполнено');
          if (r.due_date && new Date(r.due_date.replace(' ', 'T') + 'Z') < new Date())
            return el('span', { class: 'badge lost' }, 'Просрочено');
          return el('span', { class: 'badge new' }, 'В работе');
        },
      },
      {
        key: 'related',
        label: 'Связано с',
        render: (r) =>
          r.related_to_type ? `${tr('related', r.related_to_type)} #${r.related_to_id}` : '—',
      },
      { key: 'owner', label: 'Ответственный', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'type', type: 'select', options: optsFromT('activity_type'), label: 'Тип' },
      {
        key: 'status',
        type: 'select',
        options: [
          { value: '', label: 'Все' },
          { value: 'pending', label: 'В работе' },
          { value: 'completed', label: 'Выполненные' },
        ],
        label: 'Статус',
      },
    ],
    form: () => [
      {
        name: 'type',
        label: 'Тип',
        type: 'select',
        required: true,
        options: Object.entries(T.activity_type).map(([v, l]) => ({ value: v, label: l })),
      },
      { name: 'subject', label: 'Тема', required: true },
      { name: 'due_date', label: 'Срок', type: 'datetime-local' },
      {
        name: 'related_to_type',
        label: 'Связать с',
        type: 'select',
        options: optsFromT('related'),
      },
      { name: 'related_to_id', label: 'ID объекта', type: 'number' },
      {
        name: 'owner_id',
        label: 'Ответственный',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '—' },
          ...CACHE.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      { name: 'description', label: 'Описание', type: 'textarea' },
    ],
    extraActions: (row, reload) => [
      !row.completed_at
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                await api.completeActivity(row.id);
                toast('Задача выполнена', 'success');
                reload();
              },
            },
            'Выполнить',
          )
        : null,
    ],
  },
  users: {
    title: 'Пользователи',
    singular: 'пользователя',
    newLabel: 'Новый пользователь',
    editLabel: 'Редактировать пользователя',
    deleteLabel: 'Удалить пользователя?',
    columns: [
      { key: 'email', label: 'Email' },
      { key: 'name', label: 'Имя' },
      { key: 'role', label: 'Роль', render: (r) => badge(r.role, 'role') },
      {
        key: 'manager_id',
        label: 'Менеджер',
        render: (r) => (r.manager_id ? userName(r.manager_id) : '—'),
      },
      { key: 'active', label: 'Активен', render: (r) => (r.active ? '✓' : '—') },
      { key: 'created_at', label: 'Создан', render: (r) => fmtDate(r.created_at) },
    ],
    form: (editing) => [
      { name: 'email', label: 'Email', type: 'email', required: !editing },
      { name: 'name', label: 'Имя', required: !editing },
      {
        name: 'password',
        label: editing ? 'Новый пароль (оставьте пустым чтобы не менять)' : 'Пароль',
        type: 'password',
        required: !editing,
      },
      {
        name: 'role',
        label: 'Роль',
        type: 'select',
        options: Object.entries(T.role).map(([v, l]) => ({ value: v, label: l })),
      },
      {
        name: 'manager_id',
        label: 'Менеджер / РОП',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '— (нет менеджера)' },
          ...CACHE.users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
        ],
      },
      {
        name: 'warehouse',
        label: 'Склад (для роли «Склад», основной)',
        type: 'text',
      },
      {
        name: 'access_blocks',
        label: 'Блоки доступа (для роли «Менеджер»)',
        type: 'select',
        options: [
          { value: '', label: 'Все блоки (продажи + прямые)' },
          { value: 'sales', label: 'Только Продажи' },
          { value: 'direct', label: 'Только Продажи с площадок' },
          { value: 'sales,direct', label: 'Продажи + Продажи с площадок' },
        ],
      },
    ],
  },
};

// --- Приглашения — особый ресурс (не в RESOURCES, отдельная страница)

function inviteUrl(token) {
  return `${location.origin}/#/accept?token=${encodeURIComponent(token)}`;
}

export async function renderInvitations(main) {
  await loadLookups();

  let stateFilter = 'pending';
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const result = await api.list('invitations', { status: stateFilter, limit: 100 });
      renderTable(result);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function statusOfInvite(i) {
    if (i.accepted_at) return { label: 'Принято', cls: 'won' };
    if (new Date(i.expires_at) < new Date()) return { label: 'Просрочено', cls: 'lost' };
    return { label: 'Ожидает', cls: 'new' };
  }

  function renderTable(result) {
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      tableArea.append(
        el('div', { class: 'card empty' }, 'Нет приглашений в этой категории.'),
      );
      return;
    }
    const head = el(
      'tr',
      {},
      el('th', {}, 'Email'),
      el('th', {}, 'Имя'),
      el('th', {}, 'Роль'),
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Истекает'),
      el('th', {}, 'Статус'),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    const body = rows.map((r) => {
      const status = statusOfInvite(r);
      return el(
        'tr',
        {},
        el('td', {}, r.email),
        el('td', {}, r.name || '—'),
        el('td', {}, badge(r.role, 'role')),
        el('td', {}, r.manager_name || '—'),
        el('td', {}, fmtDateTime(r.expires_at)),
        el('td', {}, el('span', { class: `badge ${status.cls}` }, status.label)),
        el(
          'td',
          { style: { textAlign: 'right' } },
          !r.accepted_at
            ? el(
                'button',
                {
                  class: 'btn btn-sm',
                  onClick: async () => {
                    const link = inviteUrl(r.token);
                    try {
                      await navigator.clipboard.writeText(link);
                      toast('Ссылка скопирована', 'success');
                    } catch {
                      prompt('Скопируйте ссылку:', link);
                    }
                  },
                },
                'Скопировать ссылку',
              )
            : null,
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async () => {
                if (!(await confirm('Удалить приглашение?'))) return;
                await api.remove('invitations', r.id);
                toast('Удалено', 'success');
                reload();
              },
            },
            'Удалить',
          ),
        ),
      );
    });
    tableArea.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body)),
      ),
    );
  }

  async function openCreate() {
    const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
    const isAdmin = me.role === 'admin';
    const fields = [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'name', label: 'Имя (необязательно)' },
      {
        name: 'role',
        label: 'Роль',
        type: 'select',
        // Менеджер видит только sales; админ видит всё
        options: isAdmin
          ? Object.entries(T.role).map(([v, l]) => ({ value: v, label: l }))
          : [{ value: 'sales', label: T.role.sales }],
      },
      ...(isAdmin
        ? [
            {
              name: 'manager_id',
              label: 'Менеджер',
              type: 'select',
              numeric: true,
              options: [
                { value: '', label: '— (без менеджера)' },
                ...CACHE.users.map((u) => ({
                  value: u.id,
                  label: `${u.name} (${u.email})`,
                })),
              ],
            },
          ]
        : []),
      { name: 'ttl_days', label: 'Срок жизни (дней)', type: 'number', default: 7 },
    ];
    const { node, getValues } = buildForm(fields, {});
    let createdInvite = null;
    await openModal('Новое приглашение', node, {
      primaryLabel: 'Создать',
      onSubmit: async () => {
        createdInvite = await api.create('invitations', getValues());
        toast('Приглашение создано', 'success');
      },
    });
    if (createdInvite) {
      await showInviteLink(createdInvite);
      reload();
    }
  }

  async function showInviteLink(inv) {
    const link = inviteUrl(inv.token);
    const linkInput = el('input', { type: 'text', value: link, readonly: true });
    const body = el(
      'div',
      {},
      el('p', {}, `Отправьте эту ссылку ${inv.email}:`),
      el('div', { class: 'form-row' }, linkInput),
      el(
        'div',
        { class: 'hint' },
        `Действует до ${fmtDateTime(inv.expires_at)}. После принятия ссылка станет недействительной.`,
      ),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast('Скопировано', 'success');
            } catch {
              linkInput.select();
            }
          },
          style: { marginTop: '8px' },
        },
        'Скопировать в буфер',
      ),
    );
    await openModal('Ссылка приглашения', body, {});
  }

  // Тулбар
  const select = el(
    'select',
    {
      onChange: (e) => {
        stateFilter = e.target.value;
        reload();
      },
    },
    el('option', { value: 'pending', selected: true }, 'Ожидают принятия'),
    el('option', { value: 'accepted' }, 'Принятые'),
    el('option', { value: 'expired' }, 'Просроченные'),
    el('option', { value: '' }, 'Все'),
  );
  const toolbar = el(
    'div',
    { class: 'toolbar' },
    select,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn btn-primary', onClick: openCreate }, 'Пригласить'),
  );

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Приглашения'),
    ),
    toolbar,
    tableArea,
  );
  reload();
}

// ============================================================
// Модуль Avito (прямые продажи): заказы и касса
// ============================================================

// Площадки. Дефолты — fallback; актуальный список грузится с сервера через loadMarketplaces().
// Массив мутируется (не переприсваивается), чтобы существующие ссылки оставались валидны.
const MARKETPLACES = [
  { value: '', label: '—' },
  { value: 'Wildberries', label: 'Wildberries' },
  { value: 'Ozon', label: 'Ozon' },
  { value: 'Яндекс.Маркет', label: 'Яндекс.Маркет' },
  { value: 'Avito', label: 'Avito' },
  { value: 'Другое', label: 'Другое' },
];

export async function loadMarketplaces() {
  try {
    const r = await api.marketplacesList();
    const list = r.marketplaces || [];
    if (list.length) {
      MARKETPLACES.length = 0;
      MARKETPLACES.push({ value: '', label: '—' }, ...list.map((m) => ({ value: m, label: m })));
    }
  } catch {
    // оставляем дефолты
  }
}

// Способы доставки — управляются админом, грузятся с сервера (мутируется, ссылка сохраняется).
const DELIVERY_METHODS = ['Авито доставка', 'Почта', 'ЯМаркет', 'СДЭК', 'Dpd', '5post'];

export async function loadDeliveryMethods() {
  try {
    const r = await api.deliveryMethodsList();
    const list = r.delivery_methods || [];
    if (list.length) {
      DELIVERY_METHODS.length = 0;
      DELIVERY_METHODS.push(...list);
    }
  } catch {
    // оставляем дефолты
  }
}

function itemsEditor(initialItems = [], { getMarketplace, getWarehouse, onChange, hiddenSet = new Set() } = {}) {
  // Фильтрует stock_by_store по выбранному складу (если задан) и скрытым складам.
  function filteredStoreView(stockByStore) {
    const wh = (getWarehouse?.() || '').trim();
    let filtered = stockByStore;
    if (wh && Array.isArray(stockByStore)) {
      filtered = stockByStore.filter((s) => s.store === wh);
    }
    return computeStoreView(filtered, hiddenSet);
  }
  // Показывает наличие товара по выбранному складу под названием позиции.
  function storesText(stockByStore) {
    if (!Array.isArray(stockByStore) || !stockByStore.length) return ''; // склады не загружены
    const sv = filteredStoreView(stockByStore);
    if (!sv.visible.length) {
      const wh = (getWarehouse?.() || '').trim();
      return wh ? `⚠️ нет на складе «${wh}»` : '⚠️ нет в наличии на складах';
    }
    return '📦 ' + sv.visible.map((s) => `${s.store}: ${Math.max(0, s.stock - s.reserve)}`).join(', ');
  }
  // Обновляет подсказку наличия с учётом заказанного количества (предупреждение, если больше остатка).
  function updateStoresHint(row) {
    const meta = row._meta;
    const i = row._inputs;
    if (!i.storesHint) return;
    const hasStores = Array.isArray(meta.stock_by_store) && meta.stock_by_store.length;
    const sv = hasStores ? filteredStoreView(meta.stock_by_store) : null;
    const total = sv ? Math.max(0, sv.totalStock - sv.totalReserve) : null;
    const qty = Number(i.quantity.value) || 0;
    let text = storesText(meta.stock_by_store);
    if (total != null && qty > total) {
      text = (text ? text + ' · ' : '') + `⚠️ заказано ${qty}, в наличии ${total}`;
      i.storesHint.className = 'stores-hint warn';
    } else {
      i.storesHint.className = 'stores-hint';
    }
    i.storesHint.textContent = text;
  }
  const wrap = el('div', { class: 'items-editor' });
  const tbody = el('tbody');
  const totalCell = el('td', { colspan: '6', style: { textAlign: 'right' } }, 'Итого: 0 ₽');

  function recalc() {
    const list = getItems();
    let total = 0;
    for (const row of list) total += row.quantity * row.unit_price;
    totalCell.textContent = `Итого: ${total.toLocaleString('ru-RU')} ₽`;
    onChange?.(list);
  }

  function updatePriceHint(row) {
    const i = row._inputs;
    const current = Number(i.unit_price.value) || 0;
    const catalog = row._meta.catalog_price;
    if (catalog == null || !row._meta.product_id) {
      i.priceHint.textContent = '';
      i.priceHint.className = 'price-hint';
      return;
    }
    if (Math.abs(current - catalog) < 0.001) {
      i.priceHint.textContent = `прайс: ${catalog.toLocaleString('ru-RU')} ₽`;
      i.priceHint.className = 'price-hint match';
    } else {
      i.priceHint.textContent = `📝 изменено · прайс: ${catalog.toLocaleString('ru-RU')} ₽`;
      i.priceHint.className = 'price-hint diff';
    }
  }

  function addRow(item = {}) {
    const meta = {
      product_id: item.product_id || null,
      image_url: item.image_url || null,
      catalog_price: item.catalog_price ?? null,
      stock_by_store: item.stock_by_store ?? null,
    };
    const imageCell = el('td', { class: 'item-image-cell' });
    // Картинку показываем только у выбранного товара; для пустой строки — без плейсхолдера.
    if (meta.image_url) {
      imageCell.append(el('img', { src: meta.image_url, class: 'item-thumb', alt: '' }));
    }

    const skuI = el('input', { type: 'text', value: item.sku || '', placeholder: 'Артикул' });
    const nameI = el('input', { type: 'text', value: item.name || '', placeholder: 'Название' });
    const storesHint = el('div', { class: 'stores-hint' }, storesText(meta.stock_by_store));
    const qtyI = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      value: item.quantity || 1,
    });
    const priceI = el('input', {
      type: 'number',
      min: '0',
      step: 'any',
      value: item.unit_price ?? 0,
    });
    const priceHint = el('div', { class: 'price-hint' });

    [qtyI, priceI].forEach((i) => i.addEventListener('input', () => {
      updatePriceHint(row);
      updateStoresHint(row);
      recalc();
    }));

    const removeBtn = el(
      'button',
      {
        type: 'button',
        class: 'remove-btn',
        onClick: () => {
          row.remove();
          recalc();
        },
      },
      '×',
    );

    // data-label нужен для мобильной адаптации (CSS превращает табл. в карточки).
    imageCell.setAttribute('data-label', 'Фото');
    const row = el(
      'tr',
      {},
      imageCell,
      el('td', { 'data-label': 'Артикул' }, skuI),
      el('td', { 'data-label': 'Наименование' }, nameI, storesHint),
      el('td', { 'data-label': 'Кол-во' }, qtyI),
      el('td', { 'data-label': 'Цена' }, priceI, priceHint),
      el('td', { 'data-label': '' }, removeBtn),
    );
    row._inputs = {
      sku: skuI, name: nameI, quantity: qtyI, unit_price: priceI,
      priceHint, imageCell, storesHint,
    };
    row._meta = meta;
    tbody.append(row);
    updatePriceHint(row);
    updateStoresHint(row);
    recalc();
  }

  function getItems() {
    const out = [];
    for (const row of tbody.children) {
      const i = row._inputs;
      const name = i.name.value.trim();
      const quantity = Number(i.quantity.value) || 0;
      const unit_price = Number(i.unit_price.value) || 0;
      if (!name || quantity <= 0) continue;
      out.push({
        sku: i.sku.value.trim() || null,
        name,
        quantity,
        unit_price,
        product_id: row._meta.product_id ?? null,
        image_url: row._meta.image_url ?? null,
        catalog_price: row._meta.catalog_price ?? null,
      });
    }
    return out;
  }

  // Умножает цены всех позиций на factor (для применения скидки/наценки по сумме).
  function applyPriceFactor(factor) {
    for (const row of tbody.children) {
      const i = row._inputs;
      const cur = Number(i.unit_price.value) || 0;
      if (cur > 0) i.unit_price.value = Math.round((cur * factor + Number.EPSILON) * 100) / 100;
      updatePriceHint(row);
    }
    recalc();
  }

  // При смене площадки — переподтягиваем catalog_price для уже выбранных товаров,
  // но unit_price НЕ трогаем (если расходится — увидите подсветку).
  // Каталог тянется ОДНИМ запросом — раньше был N+1 (каждая строка дёргала api).
  async function refreshCatalogPrices() {
    const rows = [...tbody.children].filter((r) => r._meta.product_id);
    if (!rows.length) return;
    const marketplace = getMarketplace?.() || '';
    const warehouse = getWarehouse?.() || '';
    let products = [];
    try {
      const r = await api.productsForMarketplace(marketplace, '', warehouse);
      products = r.data || [];
    } catch {
      return;
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const row of rows) {
      const p = byId.get(row._meta.product_id);
      row._meta.catalog_price = p?.marketplace_price ?? null;
      updatePriceHint(row);
    }
  }

  const head = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', { style: { width: '50px' } }, ''),
      el('th', { style: { width: '140px' } }, 'Артикул'),
      el('th', {}, 'Название'),
      el('th', { style: { width: '90px' } }, 'Кол-во'),
      el('th', { style: { width: '130px' } }, 'Цена'),
      el('th', { style: { width: '32px' } }, ''),
    ),
  );
  const tfoot = el('tfoot', {}, el('tr', {}, totalCell));

  // --- Блок быстрого добавления: поиск с подсказками + полоса популярных ---

  async function addProductRow(product) {
    // Проверка наличия: если выбран склад — смотрим только по нему, иначе по всем видимым.
    const sv = filteredStoreView(product.stock_by_store);
    const hasStores = Array.isArray(product.stock_by_store) && product.stock_by_store.length;
    const available = hasStores ? Math.max(0, sv.totalStock - sv.totalReserve) : product.stock;
    if (available != null && available <= 0) {
      const ok = await confirm(`«${product.name}» нет в наличии (остаток ${available}). Всё равно добавить в заказ?`);
      if (!ok) return;
    }
    // Убираем пустые строки-заглушки: если в таблице есть строки без артикула, названия и
    // привязки к товару — они только мешают.
    for (const row of [...tbody.children]) {
      const i = row._inputs;
      const m = row._meta;
      if (!m?.product_id && !i?.sku?.value && !i?.name?.value) {
        row.remove();
      }
    }
    addRow({
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unit_price: product.marketplace_price ?? product.cost_price ?? 0,
      product_id: product.id,
      image_url: product.image_url,
      catalog_price: product.marketplace_price ?? null,
      stock_by_store: product.stock_by_store ?? null,
    });
    toast(`Товар добавлен: ${product.name}`, 'success');
  }

  // Поле поиска с autocomplete-выпадашкой
  const searchInput = el('input', {
    type: 'text',
    class: 'quick-add-search',
    placeholder: 'Начните вводить название или артикул…',
    autocomplete: 'off',
  });
  const suggestions = el('div', { class: 'quick-add-suggestions', style: { display: 'none' } });
  let highlightIndex = -1;
  let currentSuggestions = [];

  function renderSuggestions(items) {
    clear(suggestions);
    currentSuggestions = items;
    highlightIndex = -1;
    if (items.length === 0) {
      suggestions.append(
        el('div', { class: 'quick-add-empty' }, 'Ничего не найдено. Сначала добавьте товар в Каталог.'),
      );
      suggestions.style.display = 'block';
      return;
    }
    items.forEach((p, idx) => {
      suggestions.append(
        el(
          'div',
          {
            class: 'quick-add-suggestion',
            'data-idx': idx,
            onMousedown: (e) => {
              e.preventDefault();
              pickSuggestion(idx);
            },
            onMouseenter: () => setHighlight(idx),
          },
          p.image_url
            ? el('img', { src: p.image_url, class: 'qa-thumb', alt: '' })
            : el('div', { class: 'qa-thumb empty' }, '📦'),
          el(
            'div',
            { class: 'qa-info' },
            el('div', { class: 'qa-name' }, p.name),
            el(
              'div',
              { class: 'qa-meta' },
              (p.sku ? `Арт: ${p.sku}` : 'Без артикула') + (() => {
                const sv = filteredStoreView(p.stock_by_store);
                const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
                const available = hasStores ? Math.max(0, sv.totalStock - sv.totalReserve) : p.stock;
                if (available == null) return '';
                return available > 0 ? ` · 📦 ${available} шт` : ' · ⚠️ нет в наличии';
              })(),
            ),
          ),
          el(
            'div',
            { class: 'qa-price' },
            p.marketplace_price != null
              ? `${p.marketplace_price.toLocaleString('ru-RU')} ₽`
              : el('span', { class: 'qa-no-price' }, 'нет в прайсе'),
          ),
        ),
      );
    });
    suggestions.style.display = 'block';
  }

  function setHighlight(idx) {
    const items = suggestions.querySelectorAll('.quick-add-suggestion');
    items.forEach((el2) => el2.classList.remove('highlighted'));
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
    highlightIndex = idx;
  }

  function pickSuggestion(idx) {
    const p = currentSuggestions[idx];
    if (!p) return;
    addProductRow(p);
    searchInput.value = '';
    suggestions.style.display = 'none';
    currentSuggestions = [];
    searchInput.focus();
  }

  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 1) {
      suggestions.style.display = 'none';
      return;
    }
    searchDebounce = setTimeout(async () => {
      try {
        const r = await api.productsForMarketplace(getMarketplace?.() || '', q, getWarehouse?.() || '');
        renderSuggestions((r.data || []).slice(0, 8));
      } catch (e) {
        renderSuggestions([]);
      }
    }, 180);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (suggestions.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(Math.min(highlightIndex + 1, currentSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(highlightIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (highlightIndex >= 0) {
        e.preventDefault();
        pickSuggestion(highlightIndex);
      }
    } else if (e.key === 'Escape') {
      suggestions.style.display = 'none';
    }
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      suggestions.style.display = 'none';
    }, 150);
  });
  searchInput.addEventListener('focus', () => {
    if (currentSuggestions.length > 0) suggestions.style.display = 'block';
  });

  const fullCatalogBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      onClick: async () => {
        const product = await openProductPicker(getMarketplace?.() || '', hiddenSet, getWarehouse?.() || '');
        if (product) addProductRow(product);
      },
      title: 'Открыть полный каталог',
    },
    '📦 Каталог',
  );

  // Полоса 20 популярных товаров
  const popularStrip = el('div', { class: 'popular-strip' });
  const popularHeader = el(
    'div',
    { class: 'popular-header' },
    el('span', {}, '⚡ Популярные за 30 дней'),
    el('span', { class: 'popular-hint' }, 'клик — добавить'),
  );

  async function refreshPopular() {
    try {
      const r = await api.popularProducts(getMarketplace?.() || '', 30, getWarehouse?.() || '');
      clear(popularStrip);
      const items = r.data || [];
      if (items.length === 0) {
        popularStrip.append(
          el(
            'div',
            { class: 'popular-empty' },
            'В каталоге пока нет товаров. Добавьте на странице «Каталог».',
          ),
        );
        return;
      }
      for (const p of items) {
        popularStrip.append(
          el(
            'button',
            {
              type: 'button',
              class: 'popular-card',
              title: p.name + (p.sku ? ` (${p.sku})` : ''),
              onClick: () => addProductRow(p),
            },
            p.image_url
              ? el('img', { src: p.image_url, class: 'popular-card-img', alt: '' })
              : el('div', { class: 'popular-card-img empty' }, '📦'),
            el('div', { class: 'popular-card-name' }, p.name),
            el(
              'div',
              { class: 'popular-card-price' },
              p.marketplace_price != null
                ? `${p.marketplace_price.toLocaleString('ru-RU')} ₽`
                : el('span', { class: 'popular-no-price' }, 'нет в прайсе'),
            ),
            (() => {
              // Наличие по выбранному складу (доступно = stock − reserve).
              const sv = filteredStoreView(p.stock_by_store);
              const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
              const available = hasStores ? Math.max(0, sv.totalStock - sv.totalReserve) : p.stock;
              if (available == null) return null;
              return el('div', { class: `popular-card-stock${available <= 0 ? ' out' : ''}` },
                available > 0 ? `📦 ${available} шт` : '⚠️ нет');
            })(),
            p.recent_usage > 0
              ? el('div', { class: 'popular-card-badge' }, `× ${p.recent_usage}`)
              : null,
          ),
        );
      }
    } catch (e) {
      clear(popularStrip);
      popularStrip.append(el('div', { class: 'popular-empty' }, `Ошибка: ${e.message}`));
    }
  }

  const quickAddBox = el(
    'div',
    { class: 'quick-add-box' },
    el(
      'div',
      { class: 'quick-add-row' },
      el('div', { class: 'quick-add-input-wrap' }, searchInput, suggestions),
      fullCatalogBtn,
    ),
    popularHeader,
    popularStrip,
  );

  wrap.append(quickAddBox);
  wrap.append(el('table', {}, head, tbody, tfoot));

  const addBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      onClick: () => addRow(),
      style: { marginTop: '8px' },
    },
    '+ Добавить пустую позицию',
  );
  wrap.append(addBtn);

  if (initialItems.length === 0) addRow();
  else initialItems.forEach(addRow);
  recalc();
  refreshPopular();

  // Принудительно подтянуть свежие остатки из МС для текущих позиций (без ожидания
  // 15-минутного cron-тика). Вызывается сразу при открытии формы заказа.
  async function refreshStocks() {
    const productIds = [...tbody.children]
      .map((r) => r._meta?.product_id)
      .filter((v) => Number.isFinite(v));
    if (!productIds.length) return;
    try {
      const r = await api.refreshProductStocks(productIds);
      const byId = new Map((r.updated || []).map((u) => [u.id, u.stock_by_store]));
      for (const row of tbody.children) {
        const pid = row._meta?.product_id;
        if (!pid || !byId.has(pid)) continue;
        row._meta.stock_by_store = byId.get(pid);
        updateStoresHint(row);
      }
    } catch {
      // Не критично — на UI остаётся последний кэш из БД.
    }
  }

  // При смене площадки — переподтягиваем популярные (цены обновятся) + прайсы выбранных строк.
  async function refreshAll() {
    await Promise.all([refreshCatalogPrices(), refreshPopular()]);
  }

  return { node: wrap, getItems, refreshCatalogPrices: refreshAll, refreshStocks, applyPriceFactor, addProductRow };
}

// Пикер товара: открывает модалку со списком, фильтрация по поиску.
// Если задана площадка — показывает цену из её прайса.
async function openProductPicker(marketplace, hiddenSet = new Set(), warehouse = '') {
  return new Promise((resolve) => {
    const searchI = el('input', {
      type: 'search',
      placeholder: 'Поиск по названию или артикулу…',
      class: 'product-picker-search',
      autofocus: true,
    });
    const list = el('div', { class: 'product-picker-list' });

    async function load() {
      try {
        const r = await api.productsForMarketplace(marketplace, searchI.value, warehouse);
        renderList(r.data || []);
      } catch (e) {
        clear(list);
        list.append(el('div', { class: 'empty' }, e.message));
      }
    }

    function renderList(items) {
      clear(list);
      if (items.length === 0) {
        list.append(
          el(
            'div',
            { class: 'empty', style: { padding: '24px' } },
            searchI.value ? 'Ничего не найдено' : 'В каталоге пусто. Добавьте товары на странице «Каталог».',
          ),
        );
        return;
      }
      for (const p of items) {
        const price = p.marketplace_price;
        list.append(
          el(
            'div',
            {
              class: 'product-picker-item',
              onClick: () => {
                close(p);
              },
            },
            el(
              'div',
              { class: 'product-picker-thumb' },
              p.image_url
                ? el('img', { src: p.image_url, alt: '' })
                : el('div', { class: 'product-picker-thumb-empty' }, '📦'),
            ),
            el(
              'div',
              { class: 'product-picker-info' },
              el('div', { class: 'product-picker-name' }, p.name),
              el(
                'div',
                { class: 'product-picker-meta' },
                p.sku ? `Арт: ${p.sku}` : 'Без артикула',
                ' · себестоимость ',
                p.cost_price.toLocaleString('ru-RU'),
                ' ₽',
                (() => {
                  const sv = filteredStoreView(p.stock_by_store);
                  const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
                  const available = hasStores ? Math.max(0, sv.totalStock - sv.totalReserve) : p.stock;
                  if (available == null) return '';
                  return available > 0 ? ` · 📦 ${available} шт` : ' · ⚠️ нет в наличии';
                })(),
              ),
            ),
            el(
              'div',
              { class: 'product-picker-price' },
              price != null
                ? `${price.toLocaleString('ru-RU')} ₽`
                : el(
                    'span',
                    { class: 'no-price' },
                    'нет в прайсе',
                  ),
            ),
          ),
        );
      }
    }

    let debounce;
    searchI.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(load, 200);
    });

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    const modal = el(
      'div',
      { class: 'modal product-picker-modal' },
      el(
        'div',
        { class: 'modal-header' },
        el(
          'h2',
          { class: 'modal-title' },
          'Выбор товара',
          marketplace ? el('span', { class: 'picker-marketplace-tag' }, marketplace) : null,
        ),
        el('button', { class: 'modal-close', onClick: () => close(null) }, '×'),
      ),
      el('div', { class: 'modal-body', style: { padding: 0 } }, searchI, list),
    );
    const backdrop = el(
      'div',
      {
        class: 'modal-backdrop',
        onClick: (e) => {
          if (e.target === backdrop) close(null);
        },
      },
      modal,
    );
    document.getElementById('modal-root').append(backdrop);
    setTimeout(() => searchI.focus(), 0);
    load();
  });
}

// SWR-кеш для редко-меняющихся настроек формы заказа. TTL 60 сек: для повторных
// открытий формы данные берутся мгновенно, а в фоне освежаются — следующий клик
// получит свежие. На первом открытии после загрузки страницы — обычный fetch.
const ORDER_FORM_CACHE = { pricing: null, warehouses: null, schedule: null, at: 0 };
const ORDER_FORM_CACHE_TTL = 60_000;
function refreshOrderFormCache() {
  return Promise.allSettled([
    api.pricingSettings(),
    api.warehousesList(),
    api.warehouseSchedule(),
  ]).then(([p, w, s]) => {
    ORDER_FORM_CACHE.pricing = p.status === 'fulfilled' ? p.value : ORDER_FORM_CACHE.pricing;
    ORDER_FORM_CACHE.warehouses = w.status === 'fulfilled' ? w.value : ORDER_FORM_CACHE.warehouses;
    ORDER_FORM_CACHE.schedule = s.status === 'fulfilled' ? s.value : ORDER_FORM_CACHE.schedule;
    ORDER_FORM_CACHE.at = Date.now();
  });
}

// `order` со свойством `__template = true` означает «повторить»: предзаполняем поля,
// но не редактируем существующий заказ (создаём новый). track-номер не копируем —
// он уникален на отправление.
async function openOrderForm(order, onSaved, opts = {}) {
  const isTemplate = order && order.__template === true;
  const isEdit = !!order && !isTemplate;
  const cur = order || {};
  // B2B-режим (новый заказ из раздела «B2B заказы»): дефолтная классификация
  // клиента — B2B, способ оплаты — РС без НДС, маркетплейс/QR/диалог Avito
  // не показываем. Для существующего заказа определяем по marketplace.
  const isB2B = opts.b2b === true || (isEdit && !cur.marketplace);

  // Если в кеше есть свежие (TTL 60с) — используем мгновенно, иначе ждём fetch.
  const hasCache = ORDER_FORM_CACHE.pricing && ORDER_FORM_CACHE.warehouses
    && (Date.now() - ORDER_FORM_CACHE.at) < ORDER_FORM_CACHE_TTL;
  if (!hasCache) {
    await refreshOrderFormCache();
  } else {
    // Свежие — отдаём сразу, а в фоне обновим (на случай если админ менял настройки).
    refreshOrderFormCache();
  }
  // Соответствие старым переменным; ниже код этим уже пользуется.
  const pricingRes = { status: 'fulfilled', value: ORDER_FORM_CACHE.pricing || { payment_methods: [], order_tiers: [] } };
  const whRes = { status: ORDER_FORM_CACHE.warehouses ? 'fulfilled' : 'rejected', value: ORDER_FORM_CACHE.warehouses || {} };
  const schedRes = { status: ORDER_FORM_CACHE.schedule ? 'fulfilled' : 'rejected', value: ORDER_FORM_CACHE.schedule || {} };
  const pricing = pricingRes.status === 'fulfilled' ? pricingRes.value : { payment_methods: [], order_tiers: [] };
  const paymentMethods = pricing.payment_methods || [];
  const orderTiers = pricing.order_tiers || [];

  let hiddenSet = new Set();
  let allWarehouses = [];
  let defaultWarehouse = '';
  let defaultMarketplace = '';
  let defaultPaymentMethod = '';
  if (whRes.status === 'fulfilled') {
    const w = whRes.value;
    hiddenSet = new Set(w.hidden || []);
    allWarehouses = (w.all || []).filter((s) => !hiddenSet.has(s));
    defaultWarehouse = w.default_writeoff || '';
    defaultMarketplace = w.default_marketplace || '';
    defaultPaymentMethod = w.default_payment_method || '';
  }

  let shippingBanner = null;
  if (schedRes.status === 'fulfilled') {
    const sched = schedRes.value;
    if (sched?.next_shipping_date) {
      const d = new Date(sched.next_shipping_date);
      const now = new Date();
      // Берём «сегодня в МСК»: сравниваем yyyy-mm-dd, чтобы понять «сегодня/завтра».
      const fmtDate = new Intl.DateTimeFormat('ru-RU', {
        weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow',
      });
      const fmtTime = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow',
      });
      const sameYmd = (a, b) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(a) ===
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(b);
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      let prefix = '';
      if (sameYmd(d, now)) prefix = 'сегодня · ';
      else if (sameYmd(d, tomorrow)) prefix = 'завтра · ';
      shippingBanner = el(
        'div',
        {
          class: 'help-banner',
          style: {
            background: '#fef3c7', border: '1px solid #fbbf24', color: '#78350f',
            padding: '10px 12px', borderRadius: '6px', marginBottom: '12px',
            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
          },
        },
        el('span', { style: { fontSize: '18px' } }, '📦'),
        el('span', {},
          el('b', {}, 'Ближайшая отгрузка: '),
          `${prefix}${fmtDate.format(d)} до ${fmtTime.format(d)} МСК`,
        ),
      );
    } else if (sched && (!sched.days || !sched.days.length)) {
      shippingBanner = el(
        'div',
        {
          class: 'help-banner',
          style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d', padding: '8px 12px', borderRadius: '6px', marginBottom: '12px' },
        },
        '⚠️ График отгрузок не настроен. Админ → Настройки → Склады → График отгрузок.',
      );
    }
  }
  // Склад списания заказа (для МойСклад и подбора прайса по складу).
  const warehouseI = el(
    'select',
    {},
    el('option', { value: '' }, '— склад списания —'),
    ...allWarehouses.map((s) =>
      el('option', { value: s, selected: s === (cur.warehouse || defaultWarehouse) ? true : false }, s),
    ),
  );

  // Дефолт площадки: cur.marketplace (для редактирования) или канал по умолчанию (для нового заказа).
  const initialMarketplace = cur.marketplace || defaultMarketplace || '';
  const marketI = el(
    'select',
    {},
    ...MARKETPLACES.map((m) =>
      el('option', { value: m.value, selected: m.value === initialMarketplace ? true : false }, m.label),
    ),
  );
  // Стартовый статус заказа — только при создании. Дефолт «Новый»; «Ожидает товара» — если товара ещё нет.
  const statusI = !isEdit
    ? el('select', {},
        el('option', { value: 'new', selected: true }, 'Новый'),
        el('option', { value: 'waiting_stock' }, 'Ожидает товара'))
    : null;
  // Классификация клиента: B2C по умолчанию, при B2B — обязательны данные клиента.
  // В B2B-разделе дефолт «B2B (компания)», в обычных заказах — «B2C (физлицо)».
  const defaultClass = cur.client_classification || (isB2B ? 'B2B' : 'B2C');
  const classI = el(
    'select',
    {},
    // Пустой вариант нужен, чтобы для крупного Avito-заказа со скидкой по объёму
    // менеджер осознанно выбрал B2B/B2C (там значение сбрасывается в пусто).
    el('option', { value: '' }, '— укажите B2B/B2C —'),
    el('option', { value: 'B2C', selected: defaultClass === 'B2C' }, 'B2C (физлицо)'),
    el('option', { value: 'B2B', selected: defaultClass === 'B2B' }, 'B2B (компания)'),
  );
  // «Тронута» ли классификация: при редактировании уже классифицированного заказа
  // считаем, что да (не сбрасываем). Для нового — до явного выбора менеджером false.
  let classTouched = isEdit && !!cur.client_classification;
  classI.addEventListener('change', () => { classTouched = true; });
  const clientI = el('input', { type: 'text', value: cur.client_name || '', autocomplete: 'off' });
  const clientPhoneI = el('input', { type: 'tel', value: cur.client_phone || '', placeholder: '+7…', autocomplete: 'off' });

  // Автоподсказка клиента: при наборе 2+ символов → /api/orders/clients/suggest.
  // Выбор подставляет имя/телефон/классификацию из истории заказов.
  const clientSuggestions = el('div', {
    style: {
      position: 'absolute', zIndex: 1000, background: '#fff', border: '1px solid var(--border)',
      borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      maxHeight: '240px', overflowY: 'auto', display: 'none',
      left: 0, right: 0, top: '100%', marginTop: '2px',
    },
  });
  // Обёртка для позиционирования suggestions.
  const clientWrap = el('div', { style: { position: 'relative' } }, clientI, clientSuggestions);

  let clientSuggestController = null;
  let clientSuggestTimer = null;
  function hideClientSuggestions() {
    clientSuggestions.style.display = 'none';
  }
  async function loadClientSuggestions(q) {
    if (q.length < 2) { hideClientSuggestions(); return; }
    if (clientSuggestController) clientSuggestController.abort?.();
    try {
      const r = await api.suggestClients(q);
      const rows = r.data || [];
      clear(clientSuggestions);
      if (!rows.length) { hideClientSuggestions(); return; }
      for (const c of rows) {
        const item = el('div', {
          style: {
            padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center',
          },
          onMouseover: (e) => { e.currentTarget.style.background = '#f3f4f6'; },
          onMouseout: (e) => { e.currentTarget.style.background = ''; },
          onClick: () => {
            clientI.value = c.client_name || '';
            if (c.client_phone) clientPhoneI.value = c.client_phone;
            if (c.client_classification) { classI.value = c.client_classification; classTouched = true; }
            hideClientSuggestions();
            // После выбора клиента из истории — мгновенно подтянуть его последние товары.
            if (typeof refreshRecentClientItems === 'function') refreshRecentClientItems();
          },
        },
          el('div', {},
            el('div', { style: { fontSize: '14px', fontWeight: 500 } }, c.client_name),
            el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } },
              [c.client_phone, c.marketplace, `${c.count} заказ(ов)`].filter(Boolean).join(' · ')),
          ),
          el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' } },
            c.last_at ? fmtDate(c.last_at) : ''),
        );
        clientSuggestions.append(item);
      }
      clientSuggestions.style.display = 'block';
    } catch {
      hideClientSuggestions();
    }
  }
  clientI.addEventListener('input', () => {
    clearTimeout(clientSuggestTimer);
    clientSuggestTimer = setTimeout(() => loadClientSuggestions(clientI.value.trim()), 250);
  });
  clientI.addEventListener('blur', () => {
    // Задержка чтобы клик по item успел обработаться до закрытия.
    setTimeout(hideClientSuggestions, 200);
  });
  clientI.addEventListener('focus', () => {
    if (clientI.value.trim().length >= 2) loadClientSuggestions(clientI.value.trim());
  });
  const currencyI = el('input', { type: 'text', value: cur.currency || 'RUB', maxlength: '3', style: { width: '80px' } });
  const notesI = el('textarea', {}, cur.notes || '');
  // Commission UX: 4 linked fields — Сумма транзакции / % / Р / Сумма с комиссией
  // Любое поле → остальные пересчитываются. Аналог «+ комиссию» в кассе.
  // Сумма транзакции — всегда сумма позиций заказа, автосинхронизируется в renderPricingPanel().
  const commissionTxnI = el('input', {
    type: 'number', min: '0', step: '0.01', value: cur.total_amount != null ? cur.total_amount : '',
    placeholder: 'Сумма транзакции', readonly: true,
    style: { background: 'var(--bg-muted, #f3f4f6)', cursor: 'not-allowed' },
  });
  const commissionPctI = el('input', { type: 'number', min: '0', max: '100', step: '0.01', value: '', placeholder: '%' });
  const commissionRubI = el('input', { type: 'number', min: '0', step: '0.01', value: cur.commission != null ? cur.commission : '', placeholder: '0' });
  const commissionNetI = el('input', { type: 'number', min: '0', step: '0.01', value: '', placeholder: 'Сумма с комиссией' });
  // Pre-fill % and net if commission is already saved
  if (cur.commission != null && cur.total_amount) {
    const txn = Number(cur.total_amount);
    const rub = Number(cur.commission);
    if (txn > 0) {
      commissionPctI.value = (rub / txn * 100).toFixed(2);
      commissionNetI.value = (txn - rub).toFixed(2);
    }
  }
  function recalcCommission(changed) {
    const txn = Number(commissionTxnI.value) || 0;
    const pct = Number(commissionPctI.value) || 0;
    const rub = Number(commissionRubI.value) || 0;
    const net = Number(commissionNetI.value) || 0;
    if (changed === 'txn' || changed === 'pct') {
      if (txn > 0 && pct > 0) {
        const r = txn * pct / 100;
        commissionRubI.value = r.toFixed(2);
        commissionNetI.value = (txn - r).toFixed(2);
      }
    } else if (changed === 'rub') {
      if (txn > 0) {
        commissionPctI.value = (rub / txn * 100).toFixed(2);
        commissionNetI.value = (txn - rub).toFixed(2);
      }
    } else if (changed === 'net') {
      if (txn > 0) {
        const r = txn - net;
        if (r >= 0) {
          commissionRubI.value = r.toFixed(2);
          commissionPctI.value = (r / txn * 100).toFixed(2);
        }
      }
    }
  }
  commissionPctI.addEventListener('input', () => recalcCommission('pct'));
  commissionRubI.addEventListener('input', () => recalcCommission('rub'));
  commissionNetI.addEventListener('input', () => recalcCommission('net'));

  const projectI = el(
    'select',
    {},
    el('option', { value: '' }, '— без проекта —'),
    ...CACHE.projects.map((p) => el('option', { value: p.id, selected: String(p.id) === String(cur.project_id) }, p.name)),
  );
  // Заметка для менеджера — склад не видит. На форме рендерим только не-складу
  // (склад заказы редко создаёт, но на всякий случай).
  const meUser = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const meRole = meUser.role;
  const meEmail = meUser.email;
  const managerNoteI = meRole !== 'warehouse'
    ? el('textarea', { rows: '2', placeholder: 'Заметка только для менеджеров (склад не увидит)' }, cur.manager_note || '')
    : null;
  // Ссылка на диалог Avito — опциональная, заполняется по желанию.
  const avitoDialogI = el('input', { type: 'url', value: cur.avito_dialog_url || '', placeholder: 'https://www.avito.ru/...' });
  const avitoDialogRow = el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
    el('label', {}, 'Ссылка на диалог Avito'), avitoDialogI);
  // Номер отправления (трек-номер). Храним в shipment_qr. Обязателен при резерве.
  // Live-проверка дубля по реестру треков: меняешь номер → debounced GET к бэку.
  // Если занят другим активным заказом — красная плашка с № конфликта.
  const qrI = el('input', {
    type: 'text',
    value: (!isTemplate && cur.shipment_qr && !String(cur.shipment_qr).startsWith('data:')) ? cur.shipment_qr : '',
    placeholder: 'Номер отправления',
    autocomplete: 'off',
  });
  const qrWarning = el('div', {
    style: {
      display: 'none', marginTop: '6px', padding: '10px 12px',
      background: '#fef2f2', border: '2px solid #ef4444', borderRadius: '6px',
      color: '#991b1b', fontSize: '14px', fontWeight: 500,
    },
  });
  let qrConflictId = null;
  let qrCheckTimer = null;
  async function checkQrLive() {
    const qr = qrI.value.trim();
    qrConflictId = null;
    qrWarning.style.display = 'none';
    qrI.style.borderColor = '';
    if (!qr) return;
    try {
      const r = await api.checkShipmentQr(qr, isEdit ? cur.id : null);
      if (!r.ok && r.conflict) {
        qrConflictId = r.conflict.id;
        qrI.style.borderColor = '#ef4444';
        clear(qrWarning);
        qrWarning.append(
          el('div', { style: { fontSize: '15px', marginBottom: '4px' } }, '⛔ Этот номер отправления уже используется'),
          el('div', { style: { fontSize: '13px' } }, r.message || ''),
        );
        qrWarning.style.display = 'block';
      }
    } catch {
      // молча — серверная валидация сработает при сохранении
    }
  }
  qrI.addEventListener('input', () => {
    clearTimeout(qrCheckTimer);
    qrCheckTimer = setTimeout(checkQrLive, 400);
  });
  // Если в форму подставили существующий трек (при template/edit) — проверим сразу.
  if (qrI.value.trim()) setTimeout(checkQrLive, 100);
  const deliveryI = el(
    'select',
    {},
    el('option', { value: '' }, '—'),
    ...DELIVERY_METHODS.map((d) => el('option', { value: d, selected: d === cur.delivery_method ? true : false }, d)),
  );
  const deliveryRow = el('div', { class: 'form-row' }, el('label', {}, 'Способ отправки'), deliveryI);

  // При создании нового заказа cur.payment_method пуст → используем default из настроек.
  // При редактировании — сохранённое значение приоритетнее. Для B2B-заказа жёстко
  // дефолтим «РС без НДС» (rs_no_vat) — менеджер чаще всего работает именно так.
  const b2bDefaultPayment = isB2B && !isEdit ? 'rs_no_vat' : null;
  const initialPayment = cur.payment_method || b2bDefaultPayment || defaultPaymentMethod || '';
  const payI = paymentMethods.length
    ? el(
        'select',
        {},
        ...paymentMethods.map((m) =>
          el(
            'option',
            { value: m.key, selected: m.key === initialPayment ? true : false },
            `${m.label}${m.percent ? ` (${m.percent > 0 ? '+' : ''}${m.percent}%)` : ''}`,
          ),
        ),
      )
    : null;

  const pricingPanel = el('div', { class: 'order-pricing-panel' });

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  function currentPaymentPct() {
    if (!payI) return 0;
    const m = paymentMethods.find((x) => x.key === payI.value);
    return m ? Number(m.percent) || 0 : 0;
  }
  let applyTierDiscount = true; // менеджер может отклонить скидку по объёму
  let items = null; // редактор позиций; объявлен заранее, чтобы renderPricingPanel не падал
  function tierPctFor(subtotal) {
    let pct = 0;
    for (const t of orderTiers) {
      if (subtotal >= Number(t.threshold)) pct = Number(t.percent) || 0;
    }
    return pct;
  }
  // Рекомендованная цена = цена канала × (1 + % оплаты) × (1 + % по объёму).
  // Порог по объёму берётся от суммы заказа по прайсу с учётом оплаты.
  function computePricing(list) {
    const payPct = currentPaymentPct();
    let baseForTier = 0;
    for (const it of list) {
      const unit = it.catalog_price != null ? it.catalog_price : it.unit_price;
      baseForTier += unit * (1 + payPct / 100) * it.quantity;
    }
    const availTierPct = tierPctFor(baseForTier); // доступный по сумме (для предложения скидки)
    const tierPct = applyTierDiscount ? availTierPct : 0;
    let recommendedTotal = 0;
    let actualTotal = 0;
    let hasRule = false;
    for (const it of list) {
      actualTotal += it.unit_price * it.quantity;
      if (it.catalog_price != null) {
        hasRule = true;
        recommendedTotal += round2(it.catalog_price * (1 + payPct / 100) * (1 + tierPct / 100)) * it.quantity;
      } else {
        recommendedTotal += it.unit_price * it.quantity;
      }
    }
    return {
      payPct,
      tierPct,
      availTierPct,
      recommendedTotal: round2(recommendedTotal),
      actualTotal: round2(actualTotal),
      deviation: round2(actualTotal - recommendedTotal),
      hasRule,
    };
  }
  function renderPricingPanel(list) {
    // items может быть ещё не инициализирован при первом вызове из itemsEditor — безопасно берём [].
    const safeList = list || (items && items.getItems ? items.getItems() : []);
    const p = computePricing(safeList);
    // Крупный заказ на Avito со скидкой по объёму → скорее всего B2B: подсвечиваем,
    // что ФИО и классификация обязательны (клиента заносим в справочник). Пока
    // классификацию не выбрали осознанно — сбрасываем её в пусто. Enforcement — в onSubmit.
    const volDiscount = !isB2B && marketI.value === 'Avito' && p.availTierPct < 0;
    if (volDiscount && !classTouched && classI.value !== '') classI.value = '';
    else if (!volDiscount && !classTouched && classI.value === '') classI.value = defaultClass;
    clientI.style.borderColor = (volDiscount && !clientI.value.trim()) ? '#dc2626' : '';
    classI.style.borderColor = (volDiscount && !classI.value) ? '#dc2626' : '';
    // Сумма транзакции всегда = сумма позиций заказа (read-only), пересчитываем при каждом изменении состава.
    commissionTxnI.value = p.actualTotal || '';
    recalcCommission('txn');
    clear(pricingPanel);
    if (!p.hasRule && !orderTiers.length && !paymentMethods.length) return;
    pricingPanel.append(
      el('div', { class: 'opp-row' }, 'Ваша сумма: ', el('strong', {}, `${p.actualTotal.toLocaleString('ru-RU')} ₽`)),
    );
    if (p.hasRule) {
      const bits = [];
      if (p.payPct) bits.push(`оплата ${p.payPct > 0 ? '+' : ''}${p.payPct}%`);
      if (p.tierPct) bits.push(`объём ${p.tierPct > 0 ? '+' : ''}${p.tierPct}%`);
      pricingPanel.append(
        el(
          'div',
          { class: 'opp-row' },
          `По прайсу${bits.length ? ` (${bits.join(', ')})` : ''}: `,
          el('strong', {}, `${p.recommendedTotal.toLocaleString('ru-RU')} ₽`),
        ),
      );
      const match = Math.abs(p.deviation) < 1;
      pricingPanel.append(
        el(
          'div',
          { class: `opp-dev ${match ? 'match' : 'diff'}` },
          match
            ? '✓ совпадает с прайсом'
            : `${p.deviation > 0 ? '▲ выше' : '▼ ниже'} прайса на ${Math.abs(p.deviation).toLocaleString('ru-RU')} ₽`,
        ),
      );
    }
    // Предложение скидки/наценки по сумме: если порог достигнут — кнопка применения к ценам.
    const avail = p.availTierPct;
    if (avail !== 0) {
      const isDiscount = avail < 0;
      const applyBtn = el('button', {
        type: 'button',
        class: 'btn btn-sm btn-primary',
        onClick: () => {
          items.applyPriceFactor(1 + avail / 100);
          toast(`${isDiscount ? 'Скидка' : 'Наценка'} ${Math.abs(avail)}% применена к ценам`, 'success');
        },
      }, `Применить ${isDiscount ? 'скидку' : 'наценку'} ${Math.abs(avail)}%`);
      pricingPanel.append(
        el('div', { class: 'opp-discount' },
          el('span', {}, `🎯 Достигнут порог суммы — можно ${isDiscount ? 'дать скидку' : 'применить наценку'} ${Math.abs(avail)}% клиенту`),
          applyBtn,
        ),
      );
    } else if (orderTiers.length) {
      // Пороги настроены, но текущая сумма их не достигает — подсказываем ближайший.
      const next = [...orderTiers].sort((a, b) => Number(a.threshold) - Number(b.threshold))
        .find((t) => p.actualTotal < Number(t.threshold));
      if (next) {
        pricingPanel.append(
          el('div', { class: 'opp-hint' },
            `До скидки/наценки ${next.percent}% не хватает ${(Number(next.threshold) - p.actualTotal).toLocaleString('ru-RU')} ₽ (порог ${Number(next.threshold).toLocaleString('ru-RU')} ₽).`),
        );
      }
    }
    if (!p.hasRule && !orderTiers.length && paymentMethods.length) {
      pricingPanel.append(
        el('div', { class: 'opp-hint' }, 'Выберите товары из каталога — подставится цена из прайса и посчитается отклонение.'),
      );
    }
    if (volDiscount) {
      pricingPanel.append(
        el('div', { class: 'opp-hint', style: { color: '#b45309', fontWeight: 600 } },
          '🧾 Крупный заказ на Avito со скидкой по объёму — заполните ФИО клиента и классификацию (B2B/B2C) для справочника.'),
      );
    }
  }

  items = itemsEditor(cur.items || [], {
    getMarketplace: () => marketI.value,
    getWarehouse: () => warehouseI.value,
    onChange: renderPricingPanel,
    hiddenSet,
  });

  // Панель «Последние товары клиента». Показывается, когда у заказа есть клиент
  // (имя/телефон): подтягиваем 12 последних позиций именно ЭТОГО клиента — клик
  // по плитке добавляет товар в заказ с актуальной ценой по площадке+складу.
  const recentItemsPanel = el('div', { class: 'client-recent-panel', style: { display: 'none', marginBottom: '12px' } });
  let recentItemsKey = '';
  async function refreshRecentClientItems() {
    const name = clientI.value.trim();
    const phone = clientPhoneI.value.trim();
    if (!name && !phone) {
      recentItemsPanel.style.display = 'none';
      recentItemsKey = '';
      return;
    }
    const key = `${name.toLowerCase()}|${phone}|${marketI.value}|${warehouseI.value}`;
    if (key === recentItemsKey) return;
    recentItemsKey = key;
    try {
      const r = await api.clientRecentItems({
        name, phone,
        marketplace: marketI.value || '',
        warehouse: warehouseI.value || '',
      });
      const list = r.data || [];
      clear(recentItemsPanel);
      if (!list.length) {
        recentItemsPanel.style.display = 'none';
        return;
      }
      recentItemsPanel.append(
        el('div', { class: 'popular-header' },
          el('span', {}, `🧾 Последние товары клиента (${list.length})`),
          el('span', { class: 'popular-hint' }, 'клик — добавить'),
        ),
      );
      const strip = el('div', { class: 'popular-strip' });
      for (const p of list) {
        strip.append(
          el('button', {
            type: 'button',
            class: 'popular-card',
            title: p.name + (p.sku ? ` (${p.sku})` : ''),
            onClick: () => {
              if (!p.product_id) {
                toast(`«${p.name}» больше нет в каталоге — добавьте вручную`, '');
                return;
              }
              items.addProductRow({
                id: p.product_id,
                sku: p.sku,
                name: p.name,
                image_url: p.image_url,
                stock: p.stock,
                stock_by_store: p.stock_by_store,
                marketplace_price: p.marketplace_price,
                cost_price: p.cost_price,
              });
            },
          },
            p.image_url
              ? el('img', { src: p.image_url, class: 'popular-card-img', alt: '' })
              : el('div', { class: 'popular-card-img empty' }, '📦'),
            el('div', { class: 'popular-card-name' }, p.name),
            el('div', { class: 'popular-card-price' },
              p.marketplace_price != null
                ? `${Number(p.marketplace_price).toLocaleString('ru-RU')} ₽`
                : el('span', { class: 'popular-no-price' }, 'нет в прайсе'),
            ),
          ),
        );
      }
      recentItemsPanel.append(strip);
      recentItemsPanel.style.display = 'block';
    } catch {
      recentItemsPanel.style.display = 'none';
    }
  }
  // Перерисовываем после: ввода имени (debounce), смены телефона, площадки или склада.
  let recentDebounce = null;
  const scheduleRecent = () => {
    clearTimeout(recentDebounce);
    recentDebounce = setTimeout(refreshRecentClientItems, 350);
  };
  clientI.addEventListener('input', scheduleRecent);
  clientPhoneI.addEventListener('input', scheduleRecent);
  marketI.addEventListener('change', scheduleRecent);
  warehouseI.addEventListener('change', scheduleRecent);
  // Сразу подтянем для существующего/повторяемого заказа.
  if (cur.client_name || cur.client_phone) {
    refreshRecentClientItems();
  }
  // При открытии формы существующего заказа — сразу подтягиваем свежие остатки
  // из МС для позиций, чтобы менеджер видел актуальную картину, не ждал
  // 15-минутный cron.
  if ((cur.items || []).some((i) => i.product_id)) {
    items.refreshStocks();
  }
  marketI.addEventListener('change', () => {
    items.refreshCatalogPrices().then(() => renderPricingPanel());
  });
  warehouseI.addEventListener('change', () => {
    items.refreshCatalogPrices().then(() => renderPricingPanel());
  });
  if (payI) {
    payI.addEventListener('change', () => renderPricingPanel());
  }

  // Ссылка на диалог Avito видна только при площадке Avito.
  const updateAvitoVisibility = () => {
    avitoDialogRow.style.display = marketI.value === 'Avito' ? '' : 'none';
  };
  marketI.addEventListener('change', updateAvitoVisibility);
  updateAvitoVisibility();

  const body = el(
    'div',
    {},
    shippingBanner,
    el(
      'div',
      { class: 'form-grid' },
      // В B2B-режиме площадку не показываем — заказ привязки к маркетплейсу не имеет.
      isB2B ? null : el('div', { class: 'form-row' }, el('label', {}, 'Площадка'), marketI),
      el('div', { class: 'form-row' }, el('label', {}, 'Склад списания'), warehouseI),
      statusI ? el('div', { class: 'form-row' }, el('label', {}, 'Стартовый статус'), statusI) : null,
      el('div', { class: 'form-row' }, el('label', {}, 'Классификация клиента'), classI),
      el('div', { class: 'form-row' }, el('label', {}, 'Клиент / компания'), clientWrap),
      el('div', { class: 'form-row' }, el('label', {}, 'Телефон клиента'), clientPhoneI),
      payI ? el('div', { class: 'form-row' }, el('label', {}, 'Способ оплаты'), payI) : null,
      deliveryRow,
      el('div', { class: 'form-row' }, el('label', {}, 'Валюта'), currencyI),
      // Ссылка на диалог Avito и трек-номер не нужны в B2B (нет площадки, нет отправления через её доставку).
      isB2B ? null : avitoDialogRow,
      isB2B ? null : el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'Номер отправления'), el('div', {}, qrI, qrWarning)),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
      managerNoteI ? el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, '🔒 Заметка для менеджеров'), managerNoteI) : null,
      el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'Комиссия площадки'),
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' } },
          el('div', {},
            el('div', { style: { fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' } }, 'Сумма транзакции'),
            commissionTxnI,
          ),
          el('div', {},
            el('div', { style: { fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' } }, 'Комиссия %'),
            commissionPctI,
          ),
          el('div', {},
            el('div', { style: { fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' } }, 'Комиссия, ₽'),
            commissionRubI,
          ),
          el('div', {},
            el('div', { style: { fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' } }, 'Сумма с комиссией'),
            commissionNetI,
          ),
        ),
      ),
      CACHE.projects.length && meEmail === 'andrreysirko@gmail.com' ? el('div', { class: 'form-row' }, el('label', {}, 'Проект'), projectI) : null,
    ),
    recentItemsPanel,
    el('div', { class: 'form-row' },
      el('label', {},
        'Позиции заказа *',
        // Кнопка ручного освежения остатков из МС для позиций уже добавленных в заказ.
        // Полезно если форма открыта давно и менеджер хочет увидеть актуальные значения
        // до резерва. Не рендерим при создании пустого заказа — позиций ещё нет.
        (() => {
          const refreshBtn = el('button', {
            type: 'button',
            class: 'btn btn-xs',
            style: { marginLeft: '8px', verticalAlign: 'middle' },
            title: 'Запросить актуальные остатки из МойСклад для позиций в заказе',
          }, '🔄 Обновить остатки');
          refreshBtn.addEventListener('click', async () => {
            const current = items.getItems().filter((it) => it.product_id).map((it) => it.product_id);
            if (!current.length) { toast('Нет позиций с привязкой к каталогу', ''); return; }
            const orig = refreshBtn.textContent;
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳ Обновляю…';
            try {
              await api.refreshProductStocks(current);
              if (items.refreshCatalogPrices) {
                await items.refreshCatalogPrices();
                renderPricingPanel();
              }
              toast('Остатки обновлены', 'success');
            } catch (e) {
              toast(e.message || 'Не удалось обновить', 'error');
            } finally {
              refreshBtn.disabled = false;
              refreshBtn.textContent = orig;
            }
          });
          return refreshBtn;
        })(),
      ),
      items.node,
    ),
    pricingPanel,
  );

  renderPricingPanel();

  await openModal(isEdit ? `Заказ #${cur.id}` : 'Новый заказ', body, {
    primaryLabel: isEdit ? 'Сохранить' : 'Создать',
    size: 'lg',
    onSubmit: async () => {
      const orderItems = items.getItems();
      // Дубль трека — блокируем сразу, чтобы избежать лишних запросов на бэк
      // (бэк всё равно проверит, но так быстрее и понятнее пользователю).
      if (qrConflictId) {
        toast(`Номер отправления уже занят заказом #${qrConflictId} — поменяйте трек`, 'error');
        qrI.focus();
        return false;
      }
      if (orderItems.length === 0) {
        toast('Добавьте хотя бы одну позицию', 'error');
        return false;
      }
      // Ссылка на диалог Avito теперь опциональная — менеджеры заносят её по желанию.
      if (classI.value === 'B2B' && (!clientI.value.trim() || !clientPhoneI.value.trim())) {
        toast('Для B2B обязательны имя клиента и телефон', 'error');
        return false;
      }
      const p = computePricing(orderItems);
      // Крупный заказ на Avito со скидкой по объёму → скорее всего B2B. Требуем ФИО
      // клиента и явную классификацию (B2B/B2C), чтобы завести его в справочник.
      if (!isB2B && marketI.value === 'Avito' && p.availTierPct < 0) {
        if (!clientI.value.trim() || !classI.value) {
          clientI.style.borderColor = !clientI.value.trim() ? '#dc2626' : '';
          classI.style.borderColor = !classI.value ? '#dc2626' : '';
          toast('Крупный заказ на Avito со скидкой по объёму: укажите ФИО клиента и классификацию (B2B/B2C) — для справочника', 'error');
          if (!clientI.value.trim()) clientI.focus(); else classI.focus();
          return false;
        }
      }
      if (p.hasRule && Math.abs(p.deviation) >= 1) {
        const sign = p.deviation > 0 ? 'выше' : 'ниже';
        const ok = await confirm(
          `Цена не соответствует прайсу: ${sign} на ${Math.abs(p.deviation).toLocaleString('ru-RU')} ₽ ` +
            `(ваша ${p.actualTotal.toLocaleString('ru-RU')} ₽, по прайсу ${p.recommendedTotal.toLocaleString('ru-RU')} ₽). ` +
            'Сохранить с этой ценой?',
        );
        if (!ok) return false;
      }
      const payload = {
        // В B2B-режиме поля площадки/Avito-диалога/трека спрятаны и шлются как null.
        marketplace: isB2B ? null : (marketI.value || null),
        client_classification: classI.value || null,
        client_name: clientI.value || null,
        client_phone: clientPhoneI.value.trim() || null,
        currency: currencyI.value || 'RUB',
        notes: notesI.value || null,
        manager_note: managerNoteI ? (managerNoteI.value.trim() || null) : undefined,
        items: orderItems,
        payment_method: payI ? payI.value || null : cur.payment_method ?? null,
        price_deviation: p.hasRule ? p.deviation : null,
        recommended_total: p.hasRule ? p.recommendedTotal : null,
        shipment_qr: isB2B ? null : (qrI.value.trim() || null),
        delivery_method: deliveryI.value || null,
        avito_dialog_url: isB2B ? null : (avitoDialogI.value.trim() || null),
        warehouse: warehouseI.value || null,
        commission: commissionRubI.value !== '' ? Number(commissionRubI.value) : null,
        project_id: projectI.value ? Number(projectI.value) : null,
        ...(statusI ? { status: statusI.value } : {}),
      };
      if (isEdit) {
        await api.update('orders', cur.id, payload);
      } else {
        await api.create('orders', payload);
      }
      toast(isEdit ? 'Сохранено' : 'Заказ создан', 'success');
      onSaved?.();
    },
  });
}

// Диалог отмены заказа: выбор причины из списка (управляется в Интеграциях) — обязательно.
async function openCancelDialog(orderId, onDone) {
  let reasons = [];
  try {
    const r = await api.cancelReasonsList();
    reasons = r.cancel_reasons || [];
  } catch {
    /* нет списка — впишут свою */
  }
  const sel = el(
    'select',
    {},
    el('option', { value: '' }, '— выберите причину —'),
    ...reasons.map((r) => el('option', { value: r }, r)),
  );
  const customI = el('input', { type: 'text', placeholder: 'Или впишите свою причину' });
  const body = el(
    'div',
    {},
    el('div', { class: 'form-row' }, el('label', {}, 'Причина отмены *'), sel),
    el('div', { class: 'form-row' }, el('label', {}, 'Своя причина'), customI),
  );
  await openModal('Отмена заказа', body, {
    primaryLabel: 'Отменить заказ',
    onSubmit: async () => {
      const reason = customI.value.trim() || sel.value;
      if (!reason) {
        toast('Укажите причину отмены', 'error');
        return false;
      }
      try {
        await api.cancelOrder(orderId, reason);
        toast('Заказ отменён', 'success');
        await onDone?.();
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

// Отделить позицию (или её часть) в «Ожидает товара».
async function openItemWaitingDialog(order, item, onDone) {
  const qtyI = el('input', { type: 'number', min: '1', max: String(item.quantity), value: String(item.quantity), style: { maxWidth: '120px' } });
  const body = el('div', {},
    el('p', {}, `Позиция: ${item.name}.`),
    el('p', {}, `В заказе: ${item.quantity} шт по ${fmtMoney(item.unit_price, order.currency)}.`),
    el('div', { class: 'form-row' }, el('label', {}, 'Сколько штук отделить *'), qtyI),
    el('p', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, 'Выбранное количество уйдёт в новый заказ «Ожидает товара». Остаток останется в исходном.'),
  );
  await openModal('Отделить в «Ожидает товара»', body, {
    primaryLabel: 'Создать новый заказ',
    onSubmit: async () => {
      const q = Number(qtyI.value);
      if (!q || q < 1 || q > item.quantity) { toast(`Введите от 1 до ${item.quantity}`, 'error'); return false; }
      try {
        const r = await api.extractItem(order.id, item.id, { action: 'waiting', quantity: q });
        toast(`Создан заказ #${r.new_order?.id} (Ожидает товара)`, 'success');
        await onDone?.();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// Отмена позиции (или её части) — split + cancel новой части. Нужна причина.
async function openItemCancelDialog(order, item, onDone) {
  let reasons = [];
  try {
    const r = await api.cancelReasonsList();
    reasons = r.cancel_reasons || [];
  } catch { /* ignore */ }
  const qtyI = el('input', { type: 'number', min: '1', max: String(item.quantity), value: String(item.quantity), style: { maxWidth: '120px' } });
  const sel = el('select', {},
    el('option', { value: '' }, '— выберите причину —'),
    ...reasons.map((r) => el('option', { value: r }, r)),
  );
  const customI = el('input', { type: 'text', placeholder: 'Или впишите свою причину' });
  const body = el('div', {},
    el('p', {}, `Позиция: ${item.name} (${item.quantity} × ${fmtMoney(item.unit_price, order.currency)}).`),
    el('div', { class: 'form-row' }, el('label', {}, 'Сколько штук отменить *'), qtyI),
    el('div', { class: 'form-row' }, el('label', {}, 'Причина отмены *'), sel),
    el('div', { class: 'form-row' }, el('label', {}, 'Своя причина'), customI),
  );
  await openModal('Отменить позицию', body, {
    primaryLabel: 'Отменить позицию',
    onSubmit: async () => {
      const q = Number(qtyI.value);
      if (!q || q < 1 || q > item.quantity) { toast(`Введите от 1 до ${item.quantity}`, 'error'); return false; }
      const reason = customI.value.trim() || sel.value;
      if (!reason) { toast('Укажите причину отмены', 'error'); return false; }
      try {
        const r = await api.extractItem(order.id, item.id, { action: 'cancel', reason, quantity: q });
        toast(`Отменено ${q} шт (новый заказ #${r.new_order?.id})`, 'success');
        await onDone?.();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// Разделение заказа: отделить часть позиций (с количеством) в новый заказ.
async function openSplitDialog(order, onDone) {
  const items = order.items || [];
  if (!items.length) { toast('У заказа нет позиций', 'error'); return; }
  const totalUnits = items.reduce((s, i) => s + (i.quantity || 0), 0);
  if (totalUnits < 2) { toast('Чтобы разделить, в заказе должно быть минимум 2 штуки товара', 'error'); return; }

  // Для каждой позиции: чекбокс + поле «сколько штук перенести» (по умолчанию = вся позиция).
  const rows = items.map((it) => {
    const cb = el('input', { type: 'checkbox', value: String(it.id) });
    const qtyI = el('input', { type: 'number', min: '1', max: String(it.quantity), value: String(it.quantity), style: { width: '70px' }, disabled: true });
    cb.addEventListener('change', () => { qtyI.disabled = !cb.checked; });
    return { it, cb, qtyI, row: el('label', { class: 'split-row' },
      cb,
      el('span', { class: 'split-name' }, it.name),
      el('span', { class: 'split-meta' }, `${it.quantity} × ${fmtMoney(it.unit_price, order.currency)}`),
      qtyI,
    ) };
  });
  const list = el('div', { class: 'split-list' }, ...rows.map((r) => r.row));

  const statusSel = el('select', {},
    el('option', { value: 'new', selected: true }, 'Новый'),
    el('option', { value: 'waiting_stock' }, 'Ожидает товара'),
  );

  const body = el('div', {},
    el('p', {}, 'Отметьте позиции, укажите сколько штук уйдёт в НОВЫЙ заказ (по умолчанию — вся позиция). Остаток останется в исходном.'),
    list,
    el('div', { class: 'form-row' }, el('label', {}, 'Статус нового заказа'), statusSel),
  );

  await openModal(`Разделить заказ #${order.id}`, body, {
    primaryLabel: 'Создать новый заказ',
    onSubmit: async () => {
      const chosen = rows.filter((r) => r.cb.checked);
      if (!chosen.length) { toast('Отметьте хотя бы одну позицию', 'error'); return false; }
      const moves = [];
      for (const r of chosen) {
        const q = Number(r.qtyI.value);
        if (!q || q < 1 || q > r.it.quantity) {
          toast(`Кол-во для «${r.it.name}»: от 1 до ${r.it.quantity}`, 'error');
          return false;
        }
        moves.push({ item_id: r.it.id, quantity: q });
      }
      try {
        const r = await api.splitOrder(order.id, { items: moves, new_status: statusSel.value });
        toast(`Создан заказ #${r.new_order?.id}`, 'success');
        await onDone?.();
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

// Резерв с проверкой остатков: бэк возвращает 400 с многострочным сообщением
// «Недостаточно товара…». Для admin/warehouse предлагаем кнопку «всё равно»,
// которая повторяет вызов с force=1. Возвращает true если резерв успешен.
async function reserveOrderWithStockCheck(orderId) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canForce = ['admin', 'warehouse'].includes(me.role);
  // Перед резервом — освежаем остатки по позициям заказа из МойСклад напрямую,
  // чтобы избежать кейса «между cron-15-мин и нажатием Reserve товар продали».
  // Если МС недоступен или таймаут — продолжаем (бэкенд всё равно проверит по БД).
  try {
    const full = await api.get('orders', orderId);
    const productIds = (full.items || [])
      .filter((it) => it.product_id)
      .map((it) => it.product_id);
    if (productIds.length) {
      await api.refreshProductStocks(productIds);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[reserve] stock refresh failed:', e?.message);
  }
  try {
    await api.reserveOrder(orderId);
    return true;
  } catch (e) {
    const msg = e.message || '';
    const isStockIssue = msg.startsWith('Недостаточно товара');
    if (!isStockIssue) {
      toast(msg || 'Ошибка резерва', 'error');
      return false;
    }
    // Вспомогательная функция: кнопка «Перевести в Ожидает товара» в теле диалога.
    let waitingDone = false;
    function makeWaitingBtn() {
      const btn = el('button', {
        class: 'btn',
        type: 'button',
        style: { marginTop: '10px', width: '100%' },
      }, '⏳ Перевести в Ожидает товара');
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = '⏳ Переводим…';
        try {
          await api.markOrderWaiting(orderId);
          toast('Заказ переведён в «Ожидает товара»', 'success');
          waitingDone = true;
          // Закрываем диалог через Escape
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (e2) {
          toast(e2.message || 'Ошибка', 'error');
          btn.disabled = false;
          btn.textContent = '⏳ Перевести в Ожидает товара';
        }
      });
      return btn;
    }

    if (!canForce) {
      // Менеджер видит проблему и может перевести заказ в «Ожидает товара».
      const body = el('div', {},
        el('div', { style: { whiteSpace: 'pre-wrap', fontSize: '13px' } }, msg),
        makeWaitingBtn(),
      );
      await openModal('❌ Недостаточно товара', body, { primaryLabel: 'Закрыть', onSubmit: () => true });
      return waitingDone;
    }
    // admin/warehouse — даём override + кнопку «Ожидает товара».
    const body = el('div', {},
      el('div', { style: { whiteSpace: 'pre-wrap', fontSize: '13px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '10px', color: '#7f1d1d' } }, msg),
      makeWaitingBtn(),
    );
    const confirmed = await openModal('⚠️ Резерв при нехватке остатка', body, {
      primaryLabel: '⚠️ Зарезервировать всё равно',
      onSubmit: () => true,
    });
    if (waitingDone) return true;
    if (!confirmed) return false;
    try {
      await api.reserveOrder(orderId, { force: true });
      toast('Зарезервировано в обход проверки остатков', '');
      return true;
    } catch (e2) {
      toast(e2.message || 'Ошибка', 'error');
      return false;
    }
  }
}

async function openOrderImportModal(onDone, opts = {}) {
  const b2b = opts.b2b === true;
  const fileInput = el('input', { type: 'file', accept: '.csv,.txt', style: { marginBottom: '12px' } });
  const previewArea = el('div');
  const statusEl = el('div', { class: 'import-status' });
  let parsedPreview = null;

  const downloadBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      onClick: async () => {
        try {
          // B2B-страница тянет отдельный шаблон с колонками клиент/телефон.
          // Marketplace-страница — старый шаблон без полей клиента.
          const url = b2b ? '/api/orders/import-template-b2b.csv' : '/api/orders/import-template.csv';
          const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
          });
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = b2b ? 'orders-import-template-b2b.csv' : 'orders-import-template.csv';
          a.click();
          URL.revokeObjectURL(blobUrl);
        } catch (e) {
          toast(e.message, 'error');
        }
      },
    },
    '⬇ Скачать шаблон CSV',
  );

  async function parseFile(file) {
    clear(previewArea);
    parsedPreview = null;
    statusEl.textContent = '⏳ Разбираю файл…';
    try {
      const text = await file.text();
      const result = await api.create('orders/import', { csv: text, dry_run: true, b2b });
      parsedPreview = result;
      statusEl.textContent = '';
      if (!result.orders_to_create) {
        previewArea.append(el('div', { class: 'empty' }, 'Нет строк для импорта. Проверьте формат файла.'));
        return;
      }
      const rows = result.preview || [];
      const errEl = result.errors?.length
        ? el('div', { class: 'hint', style: { color: 'var(--danger)' } },
            `⚠️ Пропущено строк: ${result.errors.length}. `,
            ...result.errors.slice(0, 3).map((e) => el('div', {}, `Стр. ${e.row}: ${e.message}`)))
        : null;
      const tableRows = rows.map((g) =>
        el(
          'tr',
          {},
          el('td', {}, g.track || '—'),
          el('td', {}, g.items.length),
          el('td', {}, g.items.map((i) => i.sku).filter(Boolean).join(', ') || '—'),
          el('td', {}, fmtMoney(g.total, 'RUB')),
          el('td', {}, g.delivery || '—'),
        ),
      );
      previewArea.append(
        errEl,
        el('div', { class: 'hint' }, `Будет создано заказов: ${result.orders_to_create}`),
        el(
          'div',
          { class: 'table-wrap', style: { maxHeight: '300px', overflowY: 'auto' } },
          el(
            'table',
            { class: 'data' },
            el('thead', {},
              el('tr', {},
                el('th', {}, 'Трек'), el('th', {}, 'Позиций'),
                el('th', {}, 'Артикулы'), el('th', {}, 'Сумма'), el('th', {}, 'Доставка'),
              ),
            ),
            el('tbody', {}, ...tableRows),
          ),
        ),
      );
    } catch (e) {
      statusEl.textContent = '';
      previewArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) parseFile(fileInput.files[0]);
  });

  const body = el(
    'div',
    {},
    el('p', {}, 'Загрузите CSV-файл для создания заказов. Строки с одним трек-номером объединяются в один заказ.'),
    downloadBtn,
    el('div', { style: { margin: '12px 0' } }, fileInput),
    statusEl,
    previewArea,
  );

  await openModal('Импорт заказов из CSV', body, {
    primaryLabel: 'Создать заказы',
    size: 'lg',
    onSubmit: async () => {
      if (!parsedPreview?.orders_to_create) {
        toast('Сначала загрузите файл', 'error');
        return false;
      }
      const file = fileInput.files[0];
      if (!file) { toast('Файл не выбран', 'error'); return false; }
      try {
        const text = await file.text();
        const result = await api.create('orders/import', { csv: text, dry_run: false, b2b });
        toast(`Создано заказов: ${result.created}`, 'success');
        onDone?.();
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

export async function renderOrders(main, opts = {}) {
  await loadLookups();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isWarehouse = me.role === 'warehouse';
  const isAdmin = me.role === 'admin';
  const canCreate = ['admin', 'manager', 'sales'].includes(me.role);
  // directMode оставлено как имя переменной для совместимости — теперь это «B2B-режим».
  // В b2b-заказах нет маркетплейс-поля, дефолты подкручены под B2B (см. форму заказа).
  const directMode = opts.directMode || false;
  const pageTitle = directMode ? 'B2B заказы' : 'Продажи с площадок (Avito)';
  const pageSubtitle = directMode ? 'Заказы менеджеров: B2B-клиенты и активные продажи' : 'Заказы из маркетплейсов и с собственных сайтов';
  const viewStorageKey = directMode ? 'direct_orders_view' : 'orders_view';

  // Прогрев кеша формы заказа: пока пользователь смотрит на список, в фоне
  // загружаем pricing/warehouses/schedule. Когда нажмёт «Новый заказ» — будет мгновенно.
  if (canCreate && (!ORDER_FORM_CACHE.pricing || (Date.now() - ORDER_FORM_CACHE.at) > ORDER_FORM_CACHE_TTL)) {
    refreshOrderFormCache();
  }

  let state = { page: 1, status: '', marketplace: '', search: '', date_from: '', date_to: '', view: localStorage.getItem(viewStorageKey) || 'table' };
  // Канбан, колонка «Ожидает товара»: менеджеру/продажнику по умолчанию показываем
  // только СВОИ заказы, остальным (админ/РОП) — все. Кнопка в шапке колонки
  // переключает показ чужих. Флаг живёт на время просмотра страницы.
  const kanbanToggleRoles = ['sales', 'manager', 'admin', 'rop'].includes(me.role);
  const kanbanScopedRole = ['sales', 'manager'].includes(me.role);
  let showOthersWaiting = !kanbanScopedRole;
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      // directMode → только B2B (marketplace IS NULL).
      // Иначе — только маркетплейс-заказы (marketplace IS NOT NULL). Раньше тут
      // не было фильтра и страница «Продажи с площадок» показывала всё подряд,
      // включая B2B — что путало менеджеров и админа.
      const baseParams = directMode
        ? { ...state, direct: '1' }
        : { ...state, marketplace_only: '1' };
      if (state.view === 'kanban') {
        const result = await api.list('orders', { ...baseParams, status: '', limit: 200 });
        renderOrdersKanban(result);
      } else {
        const result = await api.list('orders', { ...baseParams, limit: 25 });
        renderTable(result);
      }
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function renderOrdersKanban(result) {
    clear(tableArea);
    const rows = result.data || [];
    const stages = ['waiting_stock', 'new', 'reserved', 'shipped', 'completed', 'cancelled'];
    // На мобиле drag&drop пальцем неудобен — заменяем на bottom-sheet с
    // кнопками действий. По клику показываем меню «куда перевести» +
    // «открыть детали». Считаем мобильным touch-устройство.
    const isTouch = window.matchMedia('(max-width: 900px)').matches || (('ontouchstart' in window) && !window.matchMedia('(min-width: 1024px)').matches);

    tableArea.append(
      el(
        'div',
        { class: 'help-banner', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
        el('span', {},
          isTouch
            ? '💡 Тапните на карточку → выберите действие. Без перетаскивания.'
            : (isWarehouse
              ? '💡 Перетаскивайте заказы: «Новый» → «Зарезервирован» → «Отгружен». Клик откроет детали.'
              : '💡 Перетащите отгруженный заказ в «Завершён», чтобы закрыть. Менеджер может отменить новый заказ.'),
        ),
        helpButton('kanban'),
      ),
    );

    // Таблица возможных переходов из текущего статуса. Используем
    // существующую transitionOrder — она знает все правила и confirm-диалоги.
    function availableTransitions(currentStatus) {
      const map = {
        waiting_stock: [
          { to: 'new', label: 'Товар поступил', icon: '✅' },
          { to: 'cancelled', label: 'Отменить', icon: '✗', dangerous: true },
        ],
        new: [
          { to: 'reserved', label: 'Зарезервировать', icon: '📦' },
          { to: 'waiting_stock', label: 'Ждём товара', icon: '⏳' },
          { to: 'cancelled', label: 'Отменить', icon: '✗', dangerous: true },
        ],
        reserved: [
          { to: 'shipped', label: 'Отгрузить', icon: '🚚' },
          { to: 'new', label: 'Снять резерв', icon: '↩️' },
          { to: 'waiting_stock', label: 'Ждём товара', icon: '⏳' },
          { to: 'cancelled', label: 'Отменить', icon: '✗', dangerous: true },
        ],
        shipped: [
          { to: 'completed', label: 'Завершить', icon: '🎯' },
          { to: 'reserved', label: 'Откатить отгрузку', icon: '↩️' },
          { to: 'cancelled', label: 'Отменить', icon: '✗', dangerous: true },
        ],
        completed: [],
        cancelled: [],
      };
      return map[currentStatus] || [];
    }

    async function showActionSheet(order) {
      const transitions = availableTransitions(order.status);
      const sheet = el('div', { class: 'action-sheet' });
      const close = () => { backdrop.remove(); };
      const backdrop = el('div', { class: 'action-sheet-backdrop', onClick: close });
      sheet.append(
        el('div', { class: 'action-sheet-handle' }),
        el('div', { class: 'action-sheet-title' },
          el('span', { class: 'action-sheet-id' }, `#${order.id}`),
          el('span', {}, order.client_name || '—'),
          el('span', { class: 'action-sheet-amount' }, fmtMoney(order.total_amount, order.currency)),
        ),
        el('div', { class: 'action-sheet-current' },
          'Сейчас: ', badge(order.status, 'order_status'),
        ),
      );
      const actions = el('div', { class: 'action-sheet-actions' });
      // Кнопка «Открыть детали» — всегда первая.
      actions.append(
        el(
          'button',
          {
            class: 'action-sheet-btn primary',
            onClick: async () => {
              close();
              try {
                const full = await api.get('orders', order.id);
                await showOrderDetails(full, reload);
              } catch (e) { toast(e.message || 'Не удалось открыть', 'error'); }
            },
          },
          '📂 Открыть детали',
        ),
      );
      // Кнопки переходов в другие статусы.
      for (const t of transitions) {
        actions.append(
          el(
            'button',
            {
              class: 'action-sheet-btn' + (t.dangerous ? ' danger' : ''),
              onClick: async () => {
                close();
                try {
                  const result = await transitionOrder(order.id, order.status, t.to);
                  if (result === false) return;
                  toast(`Заказ переведён в «${tr('order_status', t.to)}»`, 'success');
                  reload();
                } catch (e) { toast(e.message || 'Не удалось перевести', 'error'); }
              },
            },
            `${t.icon} → ${t.label}`,
          ),
        );
      }
      if (!transitions.length) {
        actions.append(el('div', { class: 'action-sheet-empty' }, `Статус «${tr('order_status', order.status)}» — финальный, переводов нет.`));
      }
      actions.append(
        el(
          'button',
          { class: 'action-sheet-btn cancel', onClick: close },
          'Отмена',
        ),
      );
      sheet.append(actions);
      backdrop.append(sheet);
      document.body.append(backdrop);
      // Esc — закрыть. Очищаем listener при close.
      const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
      document.addEventListener('keydown', onKey);
    }

    const grid = el('div', { class: 'pipeline orders-kanban' });
    for (const stage of stages) {
      let stageRows = rows.filter((r) => r.status === stage);
      // «Ожидает товара»: скрываем чужие заказы по умолчанию (для менеджера/продажника),
      // показываем по кнопке. Считаем чужих ДО фильтра — для счётчика на кнопке.
      let waitingOthers = 0;
      if (stage === 'waiting_stock' && kanbanToggleRoles) {
        waitingOthers = stageRows.filter((r) => Number(r.manager_id) !== Number(me.id)).length;
        if (!showOthersWaiting) stageRows = stageRows.filter((r) => Number(r.manager_id) === Number(me.id));
      }
      const total = stageRows.reduce((s, r) => s + (r.total_amount || 0), 0);
      const cardsWrap = el('div', { class: 'pipeline-cards' });
      const header = el(
        'div',
        { class: 'pipeline-column-header' },
        el('span', {}, tr('order_status', stage)),
        el('span', {}, `${stageRows.length} · ${fmtMoney(total, 'RUB')}`),
      );
      if (stage === 'waiting_stock' && kanbanToggleRoles) {
        const toggleBtn = el('button', {
          class: 'btn btn-sm',
          style: { marginLeft: '6px', padding: '2px 8px', fontSize: '12px' },
          title: 'Показывать заказы других менеджеров в «Ожидает товара»',
          onClick: (e) => { e.stopPropagation(); showOthersWaiting = !showOthersWaiting; renderOrdersKanban(result); },
        }, showOthersWaiting ? 'Только мои' : `Показать чужие${waitingOthers ? ` (${waitingOthers})` : ''}`);
        header.append(toggleBtn);
      }
      const column = el(
        'div',
        {
          class: 'pipeline-column',
          'data-status': stage,
          onDragover: (e) => {
            e.preventDefault();
            column.classList.add('drop-target');
          },
          onDragleave: () => column.classList.remove('drop-target'),
          onDrop: async (e) => {
            e.preventDefault();
            column.classList.remove('drop-target');
            const id = Number(e.dataTransfer.getData('text/plain'));
            const src = e.dataTransfer.getData('source-status');
            if (!id || src === stage) return;
            try {
              const result = await transitionOrder(id, src, stage);
              if (result === false) return; // пользователь отменил confirm / диалог сам отработал
              toast(`Заказ переведён в «${tr('order_status', stage)}»`, 'success');
              reload();
            } catch (err) {
              toast(err.message || 'Не удалось перевести', 'error');
            }
          },
        },
        header,
        cardsWrap,
      );
      if (stageRows.length === 0) {
        cardsWrap.append(el('div', { class: 'pipeline-empty' }, 'Пусто'));
      } else {
        for (const r of stageRows) {
          // На мобиле: клик → bottom-sheet с действиями. На десктопе: drag&drop + клик → детали.
          const cardProps = isTouch
            ? {
                class: 'pipeline-card touch',
                style: { position: 'relative' },
                onClick: () => showActionSheet(r),
              }
            : {
                class: 'pipeline-card',
                style: { position: 'relative' },
                draggable: 'true',
                onDragstart: (e) => {
                  e.dataTransfer.setData('text/plain', String(r.id));
                  e.dataTransfer.setData('source-status', r.status);
                  e.currentTarget.classList.add('dragging');
                },
                onDragend: (e) => e.currentTarget.classList.remove('dragging'),
                onClick: async (e) => {
                  const card = e.currentTarget;
                  if (card.dataset.loading === '1') return;
                  card.dataset.loading = '1';
                  card.style.opacity = '0.5';
                  card.style.pointerEvents = 'none';
                  try {
                    const full = await api.get('orders', r.id);
                    await showOrderDetails(full, reload);
                  } catch (err) {
                    toast(err.message || 'Не удалось открыть заказ', 'error');
                  } finally {
                    card.dataset.loading = '';
                    card.style.opacity = '';
                    card.style.pointerEvents = '';
                  }
                },
              };
          cardsWrap.append(
            el(
              'div',
              cardProps,
              el(
                'div',
                { class: 'order-card-head' },
                r.preview_image
                  ? el('img', {
                      src: r.preview_image,
                      class: 'order-card-thumb',
                      alt: '',
                    })
                  : el('div', { class: 'order-card-thumb empty' }, '📦'),
                el('div', { class: 'title' },
                  el('span', { style: { fontSize: '20px', fontWeight: 700, color: '#0f172a' } }, `#${r.id}`),
                  el('span', { style: { fontSize: '14px', color: 'var(--text-muted)', marginLeft: '6px' } }, '· ' + (r.client_name || 'Клиент')),
                ),
              ),
              // Чужой заказ в «Ожидает товара» (когда включён показ чужих) — помечаем менеджером.
              (stage === 'waiting_stock' && kanbanToggleRoles && Number(r.manager_id) !== Number(me.id))
                ? el('div', { class: 'meta', style: { color: '#b45309', fontWeight: 600 } }, '👤 ' + (r.manager_name || 'другой менеджер'))
                : null,
              el(
                'div',
                { class: 'meta' },
                fmtMoney(r.total_amount, r.currency),
                ' · ',
                r.marketplace || '—',
              ),
              r.reference_number
                ? el('div', { class: 'meta' }, '№ ' + r.reference_number)
                : null,
              // Трек-номер крупно, способ отправки рядом мельче — на канбане сразу
              // видно номер отправления, который менеджеру/складу важнее всего.
              (r.shipment_qr || r.delivery_method)
                ? el('div', { class: 'meta', style: { marginTop: '4px' } },
                    r.shipment_qr
                      ? el('span', { style: { fontSize: '17px', color: '#0f172a' } }, '🏷 ' + r.shipment_qr)
                      : null,
                    r.delivery_method
                      ? el('span', { style: { fontSize: '13px', color: 'var(--text-muted)', marginLeft: r.shipment_qr ? '8px' : '0' } }, '🚚 ' + r.delivery_method)
                      : null,
                  )
                : null,
              el('div', { class: 'meta' }, '👤 ' + (r.manager_name || '—') + ' · 📅 ' + fmtDate(r.created_at)),
              // Состав заказа на карточке: одна строка на позицию вида
              // «12345678  Контейнер ТРУФАСТ × 4». Имя обрезаем до 20 символов
              // (с многоточием), чтобы не ломало layout канбана.
              (r.items && r.items.length)
                ? el(
                    'div',
                    { class: 'order-card-items' },
                    ...r.items.slice(0, 8).map((it) => {
                      const nm = (it.name || '').length > 30 ? it.name.slice(0, 30) + '…' : (it.name || '');
                      return el(
                        'div',
                        { class: 'order-card-item-row', title: `${it.sku || ''} ${it.name || ''} × ${it.quantity}` },
                        it.sku
                          ? el('span', { class: 'order-card-item-sku' }, it.sku)
                          : null,
                        el('span', { class: 'order-card-item-name' }, nm || '—'),
                        el('span', { class: 'order-card-item-qty' }, '× ' + (it.quantity ?? '?')),
                      );
                    }),
                    r.items.length > 8
                      ? el('div', { class: 'order-card-item-more' }, `…и ещё ${r.items.length - 8}`)
                      : null,
                  )
                : (r.items_preview
                  ? el('div', { class: 'order-card-items', title: r.items_preview }, '📦 ' + r.items_preview)
                  : null),
              r.parent_order_id
                ? el('div', { class: 'order-card-split', title: 'Создан разделением' }, `🔀 из #${r.parent_order_id}`)
                : (r.notes && /Разделён → создан заказ #(\d+)/.test(r.notes))
                  ? el('div', { class: 'order-card-split', title: 'Был разделён' }, '🔀 разделён')
                  : null,
              r.price_deviation != null && Math.abs(r.price_deviation) >= 1
                ? el(
                    'div',
                    { class: r.price_deviation > 0 ? 'order-card-dev up' : 'order-card-dev down' },
                    `${r.price_deviation > 0 ? '▲ выше' : '▼ ниже'} прайса на ${Math.abs(r.price_deviation).toLocaleString('ru-RU')} ₽`,
                  )
                : null,
              // Позиции без прайс-листа (catalog_price=null): менеджер выставил цену
              // вручную, потому что для этого канала+склада прайса нет.
              r.items_no_price_count > 0
                ? el(
                    'div',
                    { class: 'order-card-dev no-price' },
                    `⚠️ ${r.items_no_price_count} ${r.items_no_price_count === 1 ? 'товар без прайса' : 'товара(ов) без прайса'}`,
                  )
                : null,
              // Валовая прибыль (продажа − себестоимость). Бэк отдаёт только админу/РОПу.
              r.gross_profit != null
                ? el(
                    'div',
                    { class: 'order-card-profit ' + (r.gross_profit >= 0 ? 'positive' : 'negative') },
                    `${r.gross_profit >= 0 ? '💰' : '⚠️'} Прибыль: ${r.gross_profit.toLocaleString('ru-RU')} ₽`,
                  )
                : null,
              // Заметка для менеджеров — бумажный стикер в правом верхнем углу карточки.
              // Жёлтый фон, лёгкий поворот, тень. Видна всем кроме склада (бэк не отдаёт).
              r.manager_note
                ? el('div', {
                    title: r.manager_note,
                    style: {
                      position: 'absolute', top: '8px', right: '8px',
                      maxWidth: '40%', minWidth: '90px',
                      background: '#fef9c3', border: '1px solid #facc15',
                      color: '#713f12', fontSize: '12px', lineHeight: '1.3',
                      padding: '6px 8px', borderRadius: '2px',
                      transform: 'rotate(1.5deg)',
                      boxShadow: '1px 2px 4px rgba(0,0,0,0.12)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: '4', WebkitBoxOrient: 'vertical',
                      pointerEvents: 'none', // не мешает перетаскиванию карточки
                    },
                  },
                    el('div', { style: { fontSize: '10px', color: '#a16207', marginBottom: '2px', fontWeight: 600 } }, '📌 заметка'),
                    r.manager_note,
                  )
                : null,
            ),
          );
        }
      }
      grid.append(column);
    }
    tableArea.append(grid);
  }

  async function transitionOrder(id, src, dst) {
    if (dst === 'cancelled') {
      await openCancelDialog(id, reload);
      return false; // диалог сам отменит заказ и перезагрузит — caller не показывает свой toast
    }
    if (src === 'new' && dst === 'reserved') {
      const ok = await confirm('Перевести заказ в «Зарезервирован»? Товар будет зарезервирован в МойСклад на складе списания.');
      if (!ok) return false;
      const success = await reserveOrderWithStockCheck(id);
      // Возвращаем «как бы успех», чтобы caller не показывал свой toast при отмене —
      // если success=false, уже показали диалог об ошибке.
      if (!success) return false;
      return true;
    }
    if (src === 'reserved' && dst === 'new') {
      const ok = await confirm('Снять резерв? Резерв в МойСклад снимется, незаконченная транзакция в кассе удалится.');
      if (!ok) return false;
      return api.unreserveOrder(id);
    }
    if (src === 'new' && dst === 'waiting_stock') return api.markOrderWaiting(id);
    if (src === 'reserved' && dst === 'waiting_stock') return api.markOrderWaiting(id);
    if (src === 'waiting_stock' && dst === 'new') return api.markOrderReady(id);
    if (src === 'reserved' && dst === 'shipped') {
      const ok = await confirm('Отгрузить заказ? В МойСклад будет создан документ «Отгрузка», остатки физически списываются.');
      if (!ok) return false;
      return api.shipOrder(id);
    }
    if (src === 'shipped' && dst === 'reserved') {
      const ok = await confirm('Откатить отгрузку? В МойСклад документ «Отгрузка» удалится, остатки восстановятся.');
      if (!ok) return false;
      return api.unshipOrder(id);
    }
    if (src === 'shipped' && dst === 'completed') return api.completeOrder(id);
    throw new Error(
      `Нельзя перевести из «${tr('order_status', src)}» в «${tr('order_status', dst)}».`,
    );
  }

  function renderTable(result) {
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      tableArea.append(
        emptyState({
          icon: '📦',
          title: 'Заказов пока нет',
          description: canCreate
            ? 'Создайте первый заказ кнопкой «Новый заказ» вверху, или подключите внешний сайт через раздел «Настройки».'
            : 'Когда менеджер создаст заказ, он появится здесь.',
        }),
      );
      return;
    }
    const head = el(
      'tr',
      {},
      el('th', {}, '№'),
      el('th', {}, 'Дата'),
      el('th', {}, 'Артикул'),
      el('th', {}, 'Наименование'),
      el('th', {}, 'Кол-во'),
      el('th', {}, 'Цена/шт'),
      el('th', {}, 'Сумма'),
      el('th', {}, 'Служба доставки'),
      el('th', {}, 'Трек №'),
      el('th', {}, 'Статус'),
      el('th', {}, 'Менеджер'),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    // Строим actions один раз на заказ, потом рендерим по строке на каждую
    // позицию. Первая строка заказа несёт all-cells + actions, остальные —
    // только sku/name/qty/price (даты/трек/менеджер пустые для компактности).
    function buildRowsForOrder(r) {
      const actions = [];
      // Действия склада / админа
      if ((isWarehouse || isAdmin) && r.status === 'new') {
        actions.push(
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                const ok = await reserveOrderWithStockCheck(r.id);
                if (!ok) return;
                toast('Зарезервировано', 'success');
                reload();
              },
            },
            'Резервировать',
          ),
        );
      }
      if ((isWarehouse || isAdmin) && r.status === 'reserved') {
        actions.push(
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                await api.shipOrder(r.id);
                toast('Отгружено', 'success');
                reload();
              },
            },
            'Отгрузить',
          ),
        );
      }
      // Действия менеджера / админа
      if (!isWarehouse && r.status === 'shipped') {
        actions.push(
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                await api.completeOrder(r.id);
                toast('Заказ завершён', 'success');
                reload();
              },
            },
            'Завершить',
          ),
        );
      }
      if (!['completed', 'cancelled'].includes(r.status)) {
        actions.push(
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: (e) => {
                e.stopPropagation();
                openCancelDialog(r.id, reload);
              },
            },
            'Отменить',
          ),
        );
      }
      const openOrder = async (e) => {
        const row = e.currentTarget;
        if (row.dataset.loading === '1') return;
        row.dataset.loading = '1';
        row.style.opacity = '0.5';
        row.style.pointerEvents = 'none';
        try {
          const full = await api.get('orders', r.id);
          await showOrderDetails(full, reload);
        } catch (err) {
          toast(err.message || 'Не удалось открыть заказ', 'error');
        } finally {
          row.dataset.loading = '';
          row.style.opacity = '';
          row.style.pointerEvents = '';
        }
      };
      const items = (r.items && r.items.length) ? r.items : [{ sku: r.first_item_sku, name: r.first_item_name, quantity: r.first_item_qty, unit_price: r.first_item_price, effective_price: r.first_item_catalog_price }];
      // Шапка заказа: строка с данными, выровненными по колонкам таблицы —
      // №, дата, [Артикул/Наим/Кол-во/Цена — в строках позиций], Сумма,
      // Служба доставки, Трек №, Статус, Менеджер, Действия.
      const summaryRow = el(
        'tr',
        { onClick: openOrder, class: 'order-row order-row-summary' },
        el('td', { style: { fontWeight: '700', fontSize: '15px' } }, `#${r.id}`),
        el('td', { style: { color: '#9ca3af', fontSize: '12px' } }, fmtDate(r.created_at)),
        el('td', {}),
        el('td', {}),
        el('td', {}),
        el('td', {}),
        el('td', { style: { fontWeight: '700', color: '#fbbf24' } }, fmtMoney(r.total_amount, r.currency)),
        el('td', {}, r.delivery_method || r.marketplace || ''),
        el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, r.shipment_qr ? '📦 ' + r.shipment_qr : ''),
        el('td', {}, badge(r.status, 'order_status')),
        el('td', {}, '👤 ' + (r.manager_name || '—')),
        el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() }, ...actions),
      );
      // Строки позиций: только колонки SKU/Название/Кол-во/Цена/шт + Сумма
      // по строке (qty × price). Прочие ячейки пустые → таблица читается
      // как «шапка заказа + содержимое».
      const itemRows = items.map((it) => {
        const priceCell = it.effective_price ?? it.unit_price;
        const lineSum = (priceCell != null && it.quantity != null)
          ? Number(priceCell) * Number(it.quantity)
          : null;
        return el(
          'tr',
          { onClick: openOrder, class: 'order-row order-row-item' },
          el('td', {}, ''),
          el('td', {}, ''),
          el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, it.sku || '—'),
          el('td', {}, it.name || '—'),
          el('td', {}, it.quantity != null ? String(it.quantity) : '—'),
          el('td', {}, priceCell != null ? fmtMoney(priceCell, r.currency) : '—'),
          el('td', {}, lineSum != null ? fmtMoney(lineSum, r.currency) : ''),
          el('td', {}, ''),
          el('td', {}, ''),
          el('td', {}, ''),
          el('td', {}, ''),
          el('td', {}, ''),
        );
      });
      return [summaryRow, ...itemRows];
    }
    const body = rows.flatMap(buildRowsForOrder);

    tableArea.append(
      el(
        'div',
        { class: 'table-wrap table-sticky-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body)),
      ),
      paginator(result.pagination, (p) => {
        state.page = p;
        reload();
      }),
    );
  }

  // Тулбар
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Поиск…',
    onInput: (e) => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(() => {
        state.search = e.target.value;
        state.page = 1;
        reload();
      }, 250);
    },
  });
  const statusFilter = el(
    'select',
    {
      onChange: (e) => {
        state.status = e.target.value;
        state.page = 1;
        reload();
      },
    },
    el('option', { value: '' }, 'Статус: все'),
    ...Object.entries(T.order_status).map(([v, l]) =>
      el('option', { value: v }, `Статус: ${l}`),
    ),
  );
  // В b2b-режиме маркетплейса как такового нет — фильтр прячем.
  const marketFilter = directMode ? null : el(
    'select',
    {
      onChange: (e) => {
        state.marketplace = e.target.value;
        state.page = 1;
        reload();
      },
    },
    el('option', { value: '' }, 'Площадка: все'),
    ...MARKETPLACES.filter((m) => m.value).map((m) =>
      el('option', { value: m.value }, m.label),
    ),
  );

  // Фильтр по менеджеру — виден только админу/РОПу/складу (тем, кто видит чужие заказы).
  // Помогает админу быстро отсмотреть заказы конкретного менеджера; у sales-роли
  // фильтр бессмысленный (он видит только свои заказы).
  const showManagerFilter = ['admin', 'rop', 'warehouse'].includes(me.role);
  const managerFilter = showManagerFilter ? el(
    'select',
    {
      onChange: (e) => {
        state.manager_id = e.target.value;
        state.page = 1;
        reload();
      },
    },
    el('option', { value: '' }, 'Менеджер: все'),
    ...(CACHE.users || [])
      .filter((u) => ['admin', 'manager', 'rop', 'sales'].includes(u.role) && u.active !== false)
      .map((u) => el('option', { value: String(u.id) }, u.name)),
  ) : null;

  // Фильтр дат: от-до. Пустое поле означает «без ограничения с этой стороны».
  // Чтобы выбрать один день — заполняешь обе даты одной и той же. Бэкенд
  // включает обе границы (created_at >= from И created_at < to+1d).
  const dateFromI = el('input', {
    type: 'date',
    value: state.date_from || '',
    title: 'Заказы с этой даты (включительно)',
    onChange: (e) => { state.date_from = e.target.value; state.page = 1; reload(); },
  });
  const dateToI = el('input', {
    type: 'date',
    value: state.date_to || '',
    title: 'Заказы до этой даты (включительно)',
    onChange: (e) => { state.date_to = e.target.value; state.page = 1; reload(); },
  });
  const dateClearBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      title: 'Сбросить фильтр дат',
      onClick: () => {
        dateFromI.value = ''; dateToI.value = '';
        state.date_from = ''; state.date_to = ''; state.page = 1; reload();
      },
    },
    '✕',
  );
  const dateFilterBlock = el(
    'div',
    { class: 'date-filter-block', title: 'Фильтр по дате создания заказа' },
    el('span', { class: 'date-filter-label' }, '📅'),
    dateFromI,
    el('span', { class: 'date-filter-sep' }, '—'),
    dateToI,
    dateClearBtn,
  );

  const viewToggle = el(
    'div',
    { class: 'view-toggle' },
    el(
      'button',
      {
        class: 'btn btn-sm' + (state.view === 'table' ? ' active' : ''),
        onClick: () => {
          state.view = 'table';
          localStorage.setItem(viewStorageKey, 'table');
          reload();
          updateToggle();
        },
      },
      '☰ Список',
    ),
    el(
      'button',
      {
        class: 'btn btn-sm' + (state.view === 'kanban' ? ' active' : ''),
        onClick: () => {
          state.view = 'kanban';
          localStorage.setItem(viewStorageKey, 'kanban');
          reload();
          updateToggle();
        },
      },
      '▦ Канбан',
    ),
  );

  function updateToggle() {
    const [b1, b2] = viewToggle.querySelectorAll('button');
    b1.classList.toggle('active', state.view === 'table');
    b2.classList.toggle('active', state.view === 'kanban');
  }

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    searchInput,
    statusFilter,
    marketFilter,
    managerFilter,
    dateFilterBlock,
    el('div', { class: 'spacer' }),
    viewToggle,
    el(
      'button',
      {
        class: 'btn',
        title: 'Скачать список заказов как Excel-файл (с учётом текущих фильтров)',
        onClick: async () => {
          try {
            await api.downloadOrdersCsv({
              status: state.status,
              marketplace: state.marketplace,
              manager_id: state.manager_id,
              date_from: state.date_from,
              date_to: state.date_to,
              direct: directMode ? '1' : undefined,
              marketplace_only: directMode ? undefined : '1',
            });
            toast('Excel-файл сохранён', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      '⬇ Excel',
    ),
    el(
      'button',
      {
        class: 'btn',
        title: 'Лист сборки — CSV по позициям (одна строка = один товар)',
        onClick: async () => {
          try {
            await api.downloadAssemblyList({
              status: state.status || 'reserved',
              marketplace: state.marketplace,
              date_from: state.date_from,
              date_to: state.date_to,
              direct: directMode ? '1' : undefined,
              marketplace_only: directMode ? undefined : '1',
            });
            toast('Лист сборки сохранён', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      '📋 Лист сборки',
    ),
    canCreate
      ? el(
          'button',
          {
            class: 'btn',
            title: 'Загрузить заказы из CSV-файла',
            onClick: () => openOrderImportModal(reload, { b2b: directMode }),
          },
          '⬆ Импорт',
        )
      : null,
    canCreate
      ? (() => {
          // Кнопка с состоянием загрузки — форма открывается через ~1с (3 API-запроса
          // параллельно). Без индикации пользователь думает что клик не сработал.
          const btn = el('button', { class: 'btn btn-primary' }, 'Новый заказ');
          btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            btn.disabled = true;
            const orig = btn.textContent;
            btn.textContent = '⏳ Загрузка…';
            try {
              await openOrderForm(null, reload, { b2b: directMode });
            } finally {
              btn.disabled = false;
              btn.textContent = orig;
            }
          });
          return btn;
        })()
      : null,
  );

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, pageTitle),
        el('div', { class: 'page-subtitle' }, pageSubtitle),
      ),
    ),
    el('div', { class: 'help-row' }, helpButton('orders')),
    toolbar,
    tableArea,
  );
  reload();

  // Глубокая ссылка из уведомления: «#/orders?id=123» — открываем детали заказа.
  const initialId = Number(opts.params?.get('id'));
  if (initialId) {
    api.get('orders', initialId).then((full) => {
      showOrderDetails(full, reload);
    }).catch(() => { /* нет такого заказа — ничего страшного, список уже рендерится */ });
  }
}

export function renderDirectOrders(main, opts = {}) {
  return renderOrders(main, { ...opts, directMode: true });
}

async function showOrderDetails(order, reload) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit =
    (me.role === 'admin' || me.id === order.manager_id) && order.status === 'new';
  // Отменять может: админ (включая выполненные), склад (кроме выполненных/отменённых), менеджер-владелец (только новый).
  const canCancel =
    order.status !== 'cancelled' &&
    (
      (me.role === 'admin') ||
      (me.role === 'warehouse' && order.status !== 'completed') ||
      (me.id === order.manager_id && ['new', 'reserved', 'waiting_stock'].includes(order.status))
    );
  // Разделять можно из 'new' и 'reserved' — владелец/админ. Минимум 2 штуки товара суммарно
  // (один SKU с qty=2 тоже считается делимым).
  const totalUnits = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const canSplit =
    ['new', 'reserved'].includes(order.status) &&
    (me.role === 'admin' || me.id === order.manager_id) &&
    totalUnits >= 2;
  // «Товар поступил» — из waiting_stock в new (владелец/админ/склад).
  const canMarkReady =
    order.status === 'waiting_stock' &&
    (['admin', 'warehouse'].includes(me.role) || me.id === order.manager_id);
  // «Ждём товара» из 'reserved' — только склад/админ (товар не нашли при сборке).
  const canMarkWaitingFromReserved =
    order.status === 'reserved' && ['admin', 'warehouse'].includes(me.role);
  // Снять резерв (reserved → new) — владелец/склад/админ.
  const canUnreserve =
    order.status === 'reserved' &&
    (['admin', 'warehouse'].includes(me.role) || me.id === order.manager_id);
  // Откат ошибочной отгрузки.
  const canUnship =
    order.status === 'shipped' && ['admin', 'warehouse'].includes(me.role);
  // Подтвердить отгрузку (менеджер/владелец/админ для reserved или shipped).
  const canConfirmShipping =
    ['reserved', 'shipped'].includes(order.status) &&
    !order.manager_shipping_confirmed &&
    (me.role === 'admin' || me.id === order.manager_id);
  // Per-item действия: «Ждём товар» / «Отменить» — для new/reserved при суммарно ≥ 2 шт.
  const canExtractItems =
    ['new', 'reserved'].includes(order.status) &&
    totalUnits >= 2 &&
    (['admin', 'warehouse'].includes(me.role) || me.id === order.manager_id);

  const itemsTable = el(
    'table',
    { class: 'data order-items-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { style: { width: '60px' } }, ''),
        el('th', {}, 'Артикул'),
        el('th', {}, 'Название'),
        el('th', {}, 'Кол-во'),
        el('th', {}, 'Цена'),
        el('th', {}, 'Сумма'),
        canExtractItems ? el('th', { style: { width: '180px' } }, 'Действия') : null,
      ),
    ),
    el(
      'tbody',
      {},
      ...(order.items || []).map((it) => {
        const priceCell = el('td', {});
        priceCell.append(fmtMoney(it.unit_price, order.currency));
        if (
          it.catalog_price != null &&
          Math.abs(it.unit_price - it.catalog_price) > 0.001
        ) {
          priceCell.append(
            el(
              'div',
              { class: 'price-hint diff', style: { marginTop: '2px' } },
              `📝 прайс: ${it.catalog_price.toLocaleString('ru-RU')} ₽`,
            ),
          );
        }
        return el(
          'tr',
          {},
          el(
            'td',
            { class: 'item-image-cell' },
            it.image_url
              ? el('img', { src: it.image_url, class: 'item-thumb', alt: '' })
              : el('div', { class: 'item-thumb item-thumb-empty' }, '—'),
          ),
          el('td', {}, it.sku || '—'),
          el('td', {}, it.name),
          el('td', {}, it.quantity),
          priceCell,
          el('td', {}, fmtMoney(it.line_total, order.currency)),
          canExtractItems
            ? el('td', { class: 'item-actions' },
                el('button', {
                  class: 'btn btn-xs',
                  title: 'Отделить эту позицию (или её часть) в «Ожидает товара»',
                  onClick: () => openItemWaitingDialog(order, it, () => { reload?.(); }),
                }, '⏳'),
                ' ',
                el('button', {
                  class: 'btn btn-xs btn-danger',
                  title: 'Отменить эту позицию (или её часть) — с причиной',
                  onClick: () => openItemCancelDialog(order, it, () => { reload?.(); }),
                }, '🚫'),
              )
            : null,
        );
      }),
    ),
  );

  // Подсветка статуса возврата (если есть): сразу под заголовком, до кнопок.
  const returnStatusLabels = {
    pending: '⏳ Возврат ожидает обработки',
    restocked: '↩️ Возвращён в сток',
    markdown: '🏷️ Возвращён в уценку',
    written_off: '🗑 Списан',
    lost: '❓ Товар потерян',
  };
  const returnBanner = order.return_status ? el('div', {
    style: {
      padding: '10px 12px', borderRadius: '8px', marginBottom: '12px',
      background: '#fef3c7', border: '1px solid #fbbf24', color: '#78350f',
    },
  },
    el('div', { style: { fontWeight: 600, fontSize: '14px', marginBottom: '4px' } },
      returnStatusLabels[order.return_status] || `Возврат: ${order.return_status}`),
    order.cancel_reason ? el('div', { style: { fontSize: '13px' } },
      el('b', {}, 'Причина: '), order.cancel_reason) : null,
    order.return_resolved_at ? el('div', { style: { fontSize: '12px', color: '#92400e', marginTop: '4px' } },
      `Обработан: ${fmtDateTime(order.return_resolved_at)}${order.return_resolved_by_name ? ' · ' + order.return_resolved_by_name : ''}`) : null,
    order.return_proof ? el('div', { style: { marginTop: '8px' } },
      el('button', {
        class: 'btn btn-sm',
        onClick: () => {
          openModal('Фото-пруф', el('img', { src: order.return_proof, style: { maxWidth: '100%', borderRadius: '8px' } }), { primaryLabel: null });
        },
      }, '📷 Открыть фото-пруф'),
    ) : null,
  ) : null;

  // «Повторить заказ» — менеджер/админ/sales могут на любом статусе. Создаёт новый
  // с теми же позициями/клиентом/площадкой, чтобы не вводить повторно. trackномер
  // не копируется (он уникален на отправление).
  const canRepeat = ['admin', 'manager', 'sales'].includes(me.role);
  const repeatBtn = canRepeat ? (() => {
    const btn = el('button', { class: 'btn btn-sm btn-primary' }, '🔁 Повторить заказ');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⏳ Загрузка…';
      try {
        const template = { ...order, __template: true, items: order.items || [] };
        await openOrderForm(template, () => { reload?.(); });
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
    return btn;
  })() : null;

  const body = el(
    'div',
    {},
    returnBanner,
    canRepeat
      ? el('div', { style: { marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, repeatBtn)
      : null,
    (canCancel || canSplit || canMarkReady || canMarkWaitingFromReserved || canUnreserve || canUnship || canConfirmShipping)
      ? el('div', { style: { marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          canMarkReady
            ? el('button', {
                class: 'btn btn-sm btn-primary',
                onClick: async () => {
                  try {
                    const r = await api.recheckOrderStock(order.id);
                    if (r.reserved) {
                      toast(r.message || 'Товар есть — заказ зарезервирован', 'success');
                    } else if (Array.isArray(r.missing) && r.missing.length) {
                      const list = r.missing
                        .map((m) => `${m.name || m.sku || '—'} (нужно ${m.qty}, доступно ${m.available})`)
                        .join('; ');
                      toast(`${r.message}: ${list}`, 'error');
                    } else {
                      toast(r.message || 'Не удалось зарезервировать', 'error');
                    }
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '🔄 Проверить и зарезервировать')
            : null,
          canMarkReady
            ? el('button', {
                class: 'btn btn-sm',
                onClick: async () => {
                  try {
                    await api.markOrderReady(order.id);
                    toast('Заказ переведён в «Новый»', 'success');
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '✅ Товар поступил')
            : null,
          canMarkWaitingFromReserved
            ? el('button', {
                class: 'btn btn-sm',
                onClick: async () => {
                  if (!(await confirm('Перевести весь заказ в «Ожидает товара»? Резерв будет снят.'))) return;
                  try {
                    await api.markOrderWaiting(order.id);
                    toast('Заказ переведён в «Ожидает товара»', 'success');
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '⏳ Ждём товара')
            : null,
          canUnreserve
            ? el('button', {
                class: 'btn btn-sm',
                onClick: async () => {
                  if (!(await confirm('Снять резерв с заказа? Резерв в МС будет снят, pending-приход в кассе удалён.'))) return;
                  try {
                    await api.unreserveOrder(order.id);
                    toast('Резерв снят, заказ снова «Новый»', 'success');
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '↩️ Снять резерв')
            : null,
          canUnship
            ? el('button', {
                class: 'btn btn-sm',
                onClick: async () => {
                  if (!(await confirm('Вернуть заказ в «К отгрузке» (отменить отгрузку)?'))) return;
                  try {
                    await api.unshipOrder(order.id);
                    toast('Заказ возвращён в «К отгрузке»', 'success');
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '↩️ Вернуть в к отгрузке')
            : null,
          canSplit
            ? el('button', {
                class: 'btn btn-sm',
                onClick: () => openSplitDialog(order, () => { reload?.(); }),
              }, '✂️ Разделить заказ')
            : null,
          canCancel
            ? el('button', {
                class: 'btn btn-danger btn-sm',
                onClick: () => openCancelDialog(order.id, () => { reload?.(); }),
              }, '🚫 Отменить заказ')
            : null,
          canConfirmShipping
            ? el('button', {
                class: 'btn btn-sm btn-primary',
                onClick: async () => {
                  try {
                    await api.confirmShipping(order.id);
                    toast('Отгрузка подтверждена', 'success');
                    reload?.();
                  } catch (e) { toast(e.message, 'error'); }
                },
              }, '✅ Подтвердить отгрузку')
            : null,
        )
      : null,
    el(
      'div',
      { class: 'detail-grid' },
      el('div', { class: 'k' }, 'Статус'),
      el('div', {}, badge(order.status, 'order_status')),
      el('div', { class: 'k' }, 'Площадка'),
      el('div', {}, order.marketplace || '—'),
      el('div', { class: 'k' }, 'Внешний номер'),
      el('div', {}, order.reference_number || '—'),
      ...(order.parent_order_id ? [
        el('div', { class: 'k' }, 'Создан разделением'),
        el('div', {}, `из заказа #${order.parent_order_id}`),
      ] : []),
      el('div', { class: 'k' }, 'Классификация'),
      el('div', {}, order.client_classification || '—'),
      el('div', { class: 'k' }, 'Клиент'),
      el('div', {}, order.client_name || '—'),
      el('div', { class: 'k' }, 'Менеджер'),
      el('div', {}, order.manager_name || '—'),
      el('div', { class: 'k' }, 'Склад'),
      el('div', {}, order.warehouse_user_name || '—'),
      order.manager_shipping_confirmed ? el('div', { class: 'k' }, 'Отгрузка подтверждена') : null,
      order.manager_shipping_confirmed ? el('div', { style: { color: '#15803d' } }, `✅ ${order.manager_shipping_confirmed_at ? fmtDateTime(order.manager_shipping_confirmed_at) : 'да'}`) : null,
      el('div', { class: 'k' }, 'Сумма'),
      el('div', {}, fmtMoney(order.total_amount, order.currency)),
      order.price_deviation != null && Math.abs(order.price_deviation) >= 1
        ? el('div', { class: 'k' }, 'Отклонение от прайса')
        : null,
      order.price_deviation != null && Math.abs(order.price_deviation) >= 1
        ? el(
            'div',
            { class: order.price_deviation > 0 ? 'dev-up' : 'dev-down' },
            `${order.price_deviation > 0 ? 'выше' : 'ниже'} на ${Math.abs(order.price_deviation).toLocaleString('ru-RU')} ₽` +
              (order.recommended_total != null
                ? ` (по прайсу ${order.recommended_total.toLocaleString('ru-RU')} ₽)`
                : ''),
          )
        : null,
      // Позиции без прайс-листа
      order.items_no_price_count > 0 ? el('div', { class: 'k' }, 'Без прайса') : null,
      order.items_no_price_count > 0
        ? el('div', { class: 'dev-up' }, `⚠️ ${order.items_no_price_count} ${order.items_no_price_count === 1 ? 'позиция' : 'позиций'} без цены в прайс-листе`)
        : null,
      // Валовая прибыль — только для админа/РОПа (бэк отдаёт gross_profit только им).
      order.gross_profit != null ? el('div', { class: 'k' }, 'Валовая прибыль') : null,
      order.gross_profit != null
        ? el(
            'div',
            { style: { color: order.gross_profit >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 } },
            `${order.gross_profit.toLocaleString('ru-RU')} ${order.currency || 'RUB'} (себес ${(order.cost_total || 0).toLocaleString('ru-RU')} ₽)`,
          )
        : null,
      el('div', { class: 'k' }, 'Создан'),
      el('div', {}, fmtDateTime(order.created_at)),
      order.reserved_at ? el('div', { class: 'k' }, 'Зарезервирован') : null,
      order.reserved_at ? el('div', {}, fmtDateTime(order.reserved_at)) : null,
      order.shipped_at ? el('div', { class: 'k' }, 'Отгружен') : null,
      order.shipped_at ? el('div', {}, fmtDateTime(order.shipped_at)) : null,
      order.completed_at ? el('div', { class: 'k' }, 'Завершён') : null,
      order.completed_at ? el('div', {}, fmtDateTime(order.completed_at)) : null,
      order.cancelled_at ? el('div', { class: 'k' }, 'Отменён') : null,
      order.cancelled_at
        ? el('div', {}, `${fmtDateTime(order.cancelled_at)}${order.cancel_reason ? ' — ' + order.cancel_reason : ''}`)
        : null,
    ),
    order.notes ? el('p', { style: { marginTop: '12px' } }, order.notes) : null,
    order.manager_note ? el('div', {
      style: { marginTop: '12px', padding: '10px 12px', background: '#f0f9ff', border: '1px dashed #0369a1', borderRadius: '6px', fontSize: '13px' },
    }, el('b', {}, '🔒 Заметка для менеджеров: '), order.manager_note) : null,
    el('h3', { style: { marginTop: '16px' } }, 'Позиции'),
    itemsTable,
  );

  await openModal(`Заказ #${order.id}`, body, {
    size: 'lg',
    primaryLabel: canEdit ? 'Редактировать' : undefined,
    onSubmit: canEdit
      ? async () => {
          await openOrderForm(order, reload);
          return true;
        }
      : undefined,
  });
}

// --- Касса (cashbox)

export async function renderCashbox(main) {
  await loadLookups();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  const canConfirm = ['admin', 'finance'].includes(me.role); // подтверждение транзакций
  const canFilterByManager = ['admin', 'finance'].includes(me.role);
  const state = { managerId: '', projectId: '', search: '' };
  const tableArea = el('div');
  const summaryArea = el('div');
  const filterArea = el('div', { class: 'filter-bar', style: { marginBottom: '12px' } });

  async function reload() {
    clear(summaryArea);
    clear(tableArea);
    summaryArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const paymentsQuery = { limit: 50 };
      if (state.managerId) paymentsQuery.manager_id = state.managerId;
      if (state.projectId) paymentsQuery.project_id = state.projectId;
      if (state.search) paymentsQuery.search = state.search;
      const [cashbox, payments] = await Promise.all([
        api.cashbox(undefined, state.managerId || undefined, state.projectId || undefined),
        api.list('payments', paymentsQuery),
      ]);
      renderSummary(cashbox);
      renderPayments(payments);
    } catch (e) {
      clear(summaryArea);
      summaryArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function renderFilter() {
    clear(filterArea);
    if (canFilterByManager) {
      const sel = el('select', {},
        el('option', { value: '' }, '— Все менеджеры —'),
        ...CACHE.users
          .filter((u) => ['admin', 'manager', 'sales', 'rop'].includes(u.role))
          .map((u) => el('option', { value: u.id, selected: String(u.id) === String(state.managerId) }, `${u.name} (${tr('role', u.role)})`)),
      );
      sel.addEventListener('change', () => {
        state.managerId = sel.value;
        reload();
      });
      filterArea.append(el('label', {}, '👤 Менеджер: ', sel));
    }
    if (CACHE.projects.length) {
      const psel = el('select', {},
        el('option', { value: '' }, '— Все проекты —'),
        ...CACHE.projects.map((p) => el('option', { value: p.id, selected: String(p.id) === String(state.projectId) }, p.name)),
      );
      psel.addEventListener('change', () => {
        state.projectId = psel.value;
        reload();
      });
      filterArea.append(el('label', { style: { marginLeft: '12px' } }, '📁 Проект: ', psel));
    }
    const searchInput = el('input', {
      type: 'search',
      placeholder: '🔍 Трек № или № заказа',
      value: state.search,
      style: { marginLeft: '12px', padding: '4px 8px', width: '200px' },
    });
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = searchInput.value.trim();
        reload();
      }, 400);
    });
    filterArea.append(searchInput);
  }

  function renderSummary(cashbox) {
    clear(summaryArea);
    // Две крупные суммы рядом: подтверждённый баланс и ожидающий подтверждения.
    summaryArea.append(
      el(
        'div',
        { class: 'balance-cards' },
        el(
          'div',
          { class: 'balance-card confirmed' },
          el('div', { class: 'label' }, '✅ Подтверждённый баланс'),
          el('div', { class: 'value' }, fmtMoney(cashbox.balance, 'RUB')),
          el('div', { class: 'sub' }, `${cashbox.confirmed.count} транзакций · комиссия ${fmtMoney(cashbox.confirmed.commission || 0, 'RUB')}`),
        ),
        el(
          'div',
          { class: 'balance-card pending' },
          el('div', { class: 'label' }, '⏳ Ожидает подтверждения'),
          el('div', { class: 'value' }, fmtMoney(cashbox.pending.sum, 'RUB')),
          el('div', { class: 'sub' },
            `${cashbox.pending.count} транзакций · отклонено ${cashbox.rejected.count}`,
            (cashbox.pending.commission || 0) !== 0
              ? ` · комиссия ${fmtMoney(Math.abs(cashbox.pending.commission), 'RUB')}`
              : '',
          ),
        ),
      ),
    );
  }

  function renderPayments(result) {
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      tableArea.append(el('div', { class: 'card empty' }, 'Платежей нет.'));
      return;
    }
    const head = el(
      'tr',
      {},
      el('th', {}, 'Дата'),
      el('th', {}, 'Заказ'),
      el('th', {}, 'Трек №'),
      el('th', {}, 'Сумма'),
      el('th', {}, 'Комиссия'),
      el('th', {}, 'К зачислению'),
      el('th', {}, 'Тип'),
      el('th', {}, 'Метод'),
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Статус'),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    const body = rows.map((p) => {
      // Помечаем суб-строки (комиссия к выводу) визуально и не даём редактировать.
      const isCommissionRow = p.parent_payment_id != null;
      const typeLabel = isCommissionRow
        ? el('span', { class: 'dev-down', title: `Комиссия к выводу #${p.parent_payment_id}` }, '↳ комиссия')
        : p.kind === 'expense'
          ? el('span', { class: 'dev-down' }, '− расход')
          : el('span', { class: 'dev-up' }, '+ приход');
      return el(
        'tr',
        { style: isCommissionRow ? { background: '#f9fafb' } : {} },
        el('td', {}, fmtDateTime(p.created_at)),
        el('td', {}, p.order_id ? `#${p.order_id}` : (p.reference || '—')),
        el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, p.order_shipment_qr || '—'),
        el('td', {}, fmtMoney(p.amount, p.currency)),
        el(
          'td',
          {},
          // Для суб-строки комиссии (split-расход) и для split-родителя комиссия не
          // редактируется. Pending-транзакции (приход/расход без split-комиссии) →
          // кнопка «Изменить» открывает модалку с % и ₽.
          isCommissionRow || (p.kind === 'expense' && (p.commission || 0) === 0)
            ? '—'
            : p.status === 'pending' && (canConfirm || p.manager_id === me.id)
              ? el('button', {
                  class: 'btn btn-xs',
                  onClick: () => openCommissionEditor(p),
                  style: { whiteSpace: 'nowrap' },
                }, p.commission != null && p.commission > 0
                    ? `${fmtMoney(p.commission, p.currency)} ✏️`
                    : '+ комиссию')
              : (p.commission != null && p.commission > 0 ? fmtMoney(p.commission, p.currency) : '—'),
        ),
        // К зачислению = сумма − комиссия. Для split-комиссии (sub-row) показываем
        // саму комиссию со знаком «минус» — она и есть отдельный расход. Для split-
        // вывода (commission=0 на родителе) это просто amount. Цветом подсветка:
        // приход = зелёный, расход = красный.
        (() => {
          const amt = Number(p.amount) || 0;
          const comm = Number(p.commission) || 0;
          const net = amt - comm;
          const isIncome = p.kind === 'income';
          const cls = isIncome ? 'dev-up' : 'dev-down';
          const sign = isIncome ? '+ ' : '− ';
          return el('td', {},
            el('span', { class: cls, style: { fontWeight: 600 } },
              sign + fmtMoney(net, p.currency || 'RUB')),
          );
        })(),
        el('td', {}, typeLabel),
        el('td', {}, p.method ? tr('payment_method', p.method) : '—'),
        el('td', {}, p.manager_name || '—'),
        el('td', {}, badge(p.status, 'payment_status')),
        el(
          'td',
          { style: { textAlign: 'right' } },
          canConfirm && p.status === 'pending'
            ? el(
                'button',
                {
                  class: 'btn btn-sm',
                  style: { color: 'var(--success)' },
                  onClick: async () => {
                    await api.confirmPayment(p.id);
                    toast('Подтверждено', 'success');
                    reload();
                  },
                },
                'Подтвердить',
              )
            : null,
          canConfirm && p.status === 'pending'
            ? el(
                'button',
                {
                  class: 'btn btn-sm',
                  style: { color: 'var(--danger)' },
                  onClick: async () => {
                    const reason = prompt('Причина отклонения:') || '';
                    await api.rejectPayment(p.id, reason);
                    toast('Отклонено', 'success');
                    reload();
                  },
                },
                'Отклонить',
              )
            : null,
          p.status === 'rejected' && p.rejection_reason
            ? el('span', { class: 'hint' }, p.rejection_reason)
            : null,
        ),
      );
    });
    tableArea.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body)),
      ),
    );
  }

  async function openAddPayment() {
    const amountI = el('input', { type: 'number', min: '0', step: 'any', required: true });
    const kindI = el(
      'select',
      {},
      el('option', { value: 'income' }, '+ Приход'),
      el('option', { value: 'expense' }, '− Расход (списание со счёта)'),
    );
    const methodI = el(
      'select',
      {},
      el('option', { value: '' }, '—'),
      ...Object.entries(T.payment_method).map(([v, l]) =>
        el('option', { value: v }, l),
      ),
    );
    const referenceI = el('input', { type: 'text', placeholder: 'Номер транзакции' });
    const orderI = el('input', { type: 'number', min: '1', step: '1', placeholder: '№ заказа или внутренний id (необязательно)' });
    const notesI = el('textarea', {});
    const orderDevHint = el('div', { class: 'hint' });
    const hintBlock = el('div', { class: 'hint', style: { marginBottom: '8px' } });

    function updateHint() {
      hintBlock.textContent = kindI.value === 'expense'
        ? 'Расход без комиссии. Чтобы добавить комиссию к списанию — сначала создайте, потом откройте строку в таблице.'
        : 'Приход. Комиссия (если есть) — задаётся в строке транзакции после создания.';
    }
    kindI.addEventListener('change', updateHint);

    // При привязке к заказу с отклонением цены — показываем и добавляем пометку в заметки кассы.
    orderI.addEventListener('change', async () => {
      orderDevHint.textContent = '';
      const id = Number(orderI.value);
      if (!id) return;
      try {
        const o = await api.get('orders', id);
        if (o && o.price_deviation != null && Math.abs(o.price_deviation) >= 1) {
          const sign = o.price_deviation > 0 ? 'выше' : 'ниже';
          const note = `Цена ${sign} прайса на ${Math.abs(o.price_deviation).toLocaleString('ru-RU')} ₽`;
          orderDevHint.textContent = '⚠️ ' + note;
          if (!notesI.value.includes(note)) {
            notesI.value = (notesI.value ? notesI.value + '\n' : '') + note;
          }
        }
      } catch {
        /* заказ не найден / нет доступа — игнорируем */
      }
    });

    const body = el(
      'div',
      {},
      el('div', { class: 'form-row' }, el('label', {}, 'Тип'), kindI),
      el('div', { class: 'form-row' }, el('label', {}, 'Сумма *'), amountI),
      hintBlock,
      el('div', { class: 'form-row' }, el('label', {}, 'Метод'), methodI),
      el('div', { class: 'form-row' }, el('label', {}, 'Номер транзакции'), referenceI),
      el('div', { class: 'form-row' }, el('label', {}, 'Привязать к заказу (№ или id)'), orderI, orderDevHint),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    );
    updateHint();

    await openModal('Добавить транзакцию', body, {
      primaryLabel: 'Добавить',
      onSubmit: async () => {
        const amount = Number(amountI.value);
        if (!amount || amount <= 0) {
          toast('Укажите сумму', 'error');
          return false;
        }
        await api.create('payments', {
          amount,
          kind: kindI.value,
          // Комиссия только при создании авто-расхода через order (двухтранзакционный split);
          // здесь, в ручной форме, комиссию не передаём — её ставят потом в строке.
          method: methodI.value || null,
          reference: referenceI.value || null,
          order_id: orderI.value ? Number(orderI.value) : null,
          notes: notesI.value || null,
        });
        toast('Транзакция добавлена, ждёт подтверждения', 'success');
        reload();
      },
    });
  }

  // Редактирование комиссии: три связанных поля — % / комиссия ₽ / сумма с комиссией.
  // Заполняешь любое — два других пересчитываются. Сохраняется в БД commission (₽).
  async function openCommissionEditor(payment) {
    const amount = Number(payment.amount) || 0;
    const currentRub = Number(payment.commission) || 0;
    const currentPct = amount > 0 ? Math.round((currentRub / amount) * 10000) / 100 : 0;
    const pctI = el('input', { type: 'number', min: '0', step: '0.01', value: currentPct || '', style: { width: '120px' } });
    const rubI = el('input', { type: 'number', min: '0', step: 'any', value: currentRub || '', style: { width: '120px' } });
    // «Сумма с комиссией» — сумма после удержания комиссии (нетто, то что фактически
     // приходит на счёт). = amount − commission. Заполнить можно вместо комиссии:
     // знаешь сколько пришло — впиши, комиссия посчитается обратно.
    const netI = el('input', { type: 'number', min: '0', step: 'any', value: currentRub > 0 ? Math.round((amount - currentRub) * 100) / 100 : '', style: { width: '120px' } });
    const netLine = el('div', {
      style: { padding: '12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', marginTop: '12px', textAlign: 'center' },
    });

    function refreshNet() {
      const rub = Number(rubI.value) || 0;
      const net = amount - rub;
      clear(netLine);
      netLine.append(
        el('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'К зачислению на баланс'),
        el('div', { style: { fontSize: '24px', fontWeight: 700, color: '#0369a1', marginTop: '2px' } }, fmtMoney(net, payment.currency || 'RUB')),
        el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } },
          `${fmtMoney(amount, payment.currency || 'RUB')} − комиссия ${fmtMoney(rub, payment.currency || 'RUB')}`,
        ),
      );
    }

    // Связь трёх полей: при изменении любого — остальные два пересчитываются.
    // amount фиксирован (это сумма транзакции из БД). net = amount − commission.
    pctI.addEventListener('input', () => {
      const pct = Number(pctI.value) || 0;
      const rub = Math.round(amount * pct) / 100;
      rubI.value = rub;
      netI.value = Math.round((amount - rub) * 100) / 100;
      refreshNet();
    });
    rubI.addEventListener('input', () => {
      const rub = Number(rubI.value) || 0;
      pctI.value = amount > 0 ? Math.round((rub / amount) * 10000) / 100 : 0;
      netI.value = Math.round((amount - rub) * 100) / 100;
      refreshNet();
    });
    netI.addEventListener('input', () => {
      const net = Number(netI.value) || 0;
      const rub = Math.max(0, Math.round((amount - net) * 100) / 100);
      rubI.value = rub > 0 ? rub : '';
      pctI.value = amount > 0 && rub > 0 ? Math.round((rub / amount) * 10000) / 100 : '';
      refreshNet();
    });

    const body = el('div', {},
      el('div', { class: 'form-row' },
        el('label', {}, 'Сумма транзакции'),
        el('div', {}, el('b', {}, fmtMoney(amount, payment.currency || 'RUB'))),
      ),
      el('div', { class: 'form-row' },
        el('label', {}, 'Комиссия %'),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, pctI, el('span', {}, '%')),
      ),
      el('div', { class: 'form-row' },
        el('label', {}, 'Комиссия ₽'),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, rubI, el('span', {}, '₽')),
      ),
      el('div', { class: 'form-row' },
        el('label', {}, 'Сумма с комиссией'),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, netI, el('span', {}, '₽')),
      ),
      el('div', { class: 'hint', style: { marginTop: '4px' } },
        'Заполни любое из трёх полей — остальные пересчитаются. «Сумма с комиссией» = сколько реально пришло на счёт после удержания комиссии (= сумма транзакции − комиссия).'),
      netLine,
    );
    refreshNet();

    await openModal(`Комиссия к транзакции #${payment.id}`, body, {
      primaryLabel: 'Сохранить',
      onSubmit: async () => {
        const rub = Number(rubI.value) || 0;
        if (rub < 0) { toast('Комиссия не может быть отрицательной', 'error'); return false; }
        if (rub > amount) { toast('Комиссия больше суммы транзакции', 'error'); return false; }
        try {
          await api.update('payments', payment.id, { commission: rub === 0 ? null : rub });
          toast('Комиссия сохранена', 'success');
          reload();
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    });
  }

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Касса'),
      el('button', { class: 'btn btn-primary', onClick: openAddPayment }, 'Добавить транзакцию'),
    ),
    el('div', { class: 'help-row' }, helpButton('cashbox')),
    filterArea,
    summaryArea,
    el('h3', { class: 'page-subtitle', style: { marginTop: '16px', marginBottom: '8px' } }, 'Транзакции'),
    tableArea,
  );
  renderFilter();
  reload();
}

// --- Страница принятия приглашения (без авторизации)
export async function renderAcceptInvite(root, token, onAccepted) {
  let invite;
  try {
    invite = await api.inviteByToken(token);
  } catch (e) {
    root.append(
      el(
        'div',
        { class: 'login-page' },
        el(
          'div',
          { class: 'login-box' },
          el('h1', {}, 'Приглашение не найдено'),
          el('p', {}, 'Ссылка недействительна или приглашение уже использовано.'),
          el(
            'a',
            { href: '#/login', class: 'btn btn-primary', style: { width: '100%' } },
            'К входу',
          ),
        ),
      ),
    );
    return;
  }
  if (invite.accepted_at) {
    root.append(
      el(
        'div',
        { class: 'login-page' },
        el(
          'div',
          { class: 'login-box' },
          el('h1', {}, 'Приглашение уже использовано'),
          el(
            'a',
            { href: '#/login', class: 'btn btn-primary', style: { width: '100%' } },
            'Войти',
          ),
        ),
      ),
    );
    return;
  }
  if (new Date(invite.expires_at) < new Date()) {
    root.append(
      el(
        'div',
        { class: 'login-page' },
        el(
          'div',
          { class: 'login-box' },
          el('h1', {}, 'Приглашение просрочено'),
          el('p', {}, 'Попросите менеджера выслать новое приглашение.'),
        ),
      ),
    );
    return;
  }

  const nameInput = el('input', { type: 'text', placeholder: 'Ваше имя', value: invite.name || '' });
  const passInput = el('input', { type: 'password', placeholder: 'Придумайте пароль' });
  const submit = async () => {
    try {
      const r = await api.acceptInvite(token, nameInput.value, passInput.value);
      onAccepted(r);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  root.append(
    el(
      'div',
      { class: 'login-page' },
      el(
        'form',
        {
          class: 'login-box',
          onSubmit: (e) => {
            e.preventDefault();
            submit();
          },
        },
        el('h1', {}, 'Принятие приглашения'),
        el(
          'p',
          { class: 'hint' },
          `Email: ${invite.email}. Роль: ${tr('role', invite.role)}.`,
        ),
        el('div', { class: 'form-row' }, el('label', {}, 'Имя'), nameInput),
        el('div', { class: 'form-row' }, el('label', {}, 'Пароль'), passInput),
        el(
          'button',
          { class: 'btn btn-primary', type: 'submit', style: { width: '100%' } },
          'Зарегистрироваться',
        ),
      ),
    ),
  );
}

// ============================================================
// Универсальный список ресурса
// ============================================================

export async function renderResource(main, key, opts = {}) {
  await loadLookups();
  const cfg = RESOURCES[key];
  if (!cfg) return main.append(el('div', {}, 'Неизвестный раздел'));

  let state = { page: 1, search: '', filters: {} };

  const tableArea = el('div');

  function reload() {
    fetchAndRender();
  }

  async function fetchAndRender() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const query = { page: state.page, limit: 25, ...state.filters };
      if (state.search) query.search = state.search;
      const result = await api.list(key, query);
      renderTable(result);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function renderTable(result) {
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      const icons = {
        companies: '🏢',
        contacts: '👥',
        leads: '🌱',
        deals: '💼',
        activities: '📋',
        users: '🧑',
      };
      const helps = {
        companies: 'Компании — это юрлица, с которыми ведутся сделки. Добавьте первую — и сможете привязывать к ней контакты, лиды и сделки.',
        contacts: 'Контакты — это конкретные люди (как правило, представители компаний). Удобно фиксировать имя, телефон, должность.',
        leads: 'Лиды — потенциальные клиенты, которые ещё не стали покупателями. Когда лид готов к сделке, нажмите «Конвертировать».',
        deals: 'Сделки — это потенциальные продажи. У каждой есть стадия и сумма. На странице «Воронка» их удобно двигать мышью.',
        activities: 'Задачи — звонки, встречи, письма, дела. Привязываются к контактам, компаниям, лидам или сделкам.',
        users: 'Пользователи системы. Чтобы добавить нового — нажмите «Добавить» справа сверху: укажите email, имя, пароль и роль, передайте сотруднику логин/пароль — он сразу сможет войти. Альтернатива (если нужно чтобы человек сам задал пароль) — раздел «Приглашения».',
      };
      tableArea.append(
        emptyState({
          icon: icons[key] || '📭',
          title: state.search ? 'Ничего не найдено' : `${cfg.title}: пока пусто`,
          description: state.search
            ? `По запросу «${state.search}» совпадений нет. Попробуйте другой запрос.`
            : helps[key] || 'Нажмите «Добавить» чтобы создать первую запись.',
        }),
      );
      return;
    }
    const head = el(
      'tr',
      {},
      ...cfg.columns.map((c) => el('th', {}, c.label)),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    const body = rows.map((row) =>
      el(
        'tr',
        { onClick: () => openEdit(row) },
        ...cfg.columns.map((c) => {
          const v = c.render ? c.render(row) : row[c.key];
          return el('td', {}, v == null || v === '' ? '—' : v);
        }),
        el(
          'td',
          { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
          ...(cfg.extraActions ? cfg.extraActions(row, reload).filter(Boolean) : []),
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async () => {
                if (!(await confirm(cfg.deleteLabel))) return;
                try {
                  await api.remove(key, row.id);
                  toast('Удалено', 'success');
                  reload();
                } catch (e) {
                  toast(e.message, 'error');
                }
              },
            },
            'Удалить',
          ),
        ),
      ),
    );

    tableArea.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body)),
      ),
      paginator(result.pagination, (p) => {
        state.page = p;
        fetchAndRender();
      }),
    );
  }

  async function openEdit(row) {
    const fields = cfg.form(true);
    const { node, getValues } = buildForm(fields, row);
    await openModal(cfg.editLabel, node, {
      primaryLabel: 'Сохранить',
      size: fields.length >= 6 ? 'lg' : undefined,
      onSubmit: async () => {
        const data = getValues();
        if ('password' in data && !data.password) delete data.password;
        await api.update(key, row.id, data);
        toast('Сохранено', 'success');
        reload();
      },
    });
  }

  async function openCreate() {
    const fields = cfg.form(false);
    const { node, getValues } = buildForm(fields, {});
    await openModal(cfg.newLabel, node, {
      primaryLabel: 'Создать',
      size: fields.length >= 6 ? 'lg' : undefined,
      onSubmit: async () => {
        await api.create(key, getValues());
        toast('Создано', 'success');
        reload();
      },
    });
  }

  // Тулбар
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Поиск…',
    value: state.search,
    onInput: (e) => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(() => {
        state.search = e.target.value;
        state.page = 1;
        fetchAndRender();
      }, 250);
    },
  });

  const toolbar = el('div', { class: 'toolbar' }, searchInput);
  for (const f of cfg.filters || []) {
    if (f.type === 'select') {
      // options могут быть функцией (для динамических справочников типа проектов).
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      const sel = el(
        'select',
        {
          onChange: (e) => {
            state.filters[f.key] = e.target.value || undefined;
            state.page = 1;
            fetchAndRender();
          },
        },
        ...opts.map((o) => el('option', { value: o.value }, `${f.label}: ${o.label}`)),
      );
      toolbar.append(sel);
    } else {
      const inp = el('input', {
        type: 'text',
        placeholder: f.label,
        onInput: (e) => {
          clearTimeout(inp._t);
          inp._t = setTimeout(() => {
            state.filters[f.key] = e.target.value || undefined;
            state.page = 1;
            fetchAndRender();
          }, 250);
        },
      });
      toolbar.append(inp);
    }
  }
  toolbar.append(
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn btn-primary', onClick: openCreate }, 'Добавить'),
  );

  main.append(
    el('div', { class: 'page-header' }, el('div', {}, el('h1', { class: 'page-title' }, cfg.title))),
    toolbar,
    tableArea,
  );

  fetchAndRender();

  // Глубокая ссылка из уведомления: «#/leads?id=42» — открываем форму конкретной записи.
  const initialId = Number(opts.params?.get('id'));
  if (initialId) {
    api.get(key, initialId).then((row) => {
      if (row) openEdit(row);
    }).catch(() => { /* нет такой записи — список уже отрендерился */ });
  }
}

// ============================================================
// Дашборд
// ============================================================

export async function renderDashboard(main) {
  await loadLookups();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');

  // Инструкция «как работать» по роли (закрывает часть #6 — памятка прямо на дашборде).
  const tipsForRole = {
    admin: 'Вы видите все данные и настройки. Настройки, роли, площадки, бэкап — в вашем ведении.',
    rop: 'Вы видите данные своих менеджеров и аналитику отдела. Контролируйте воронку и выполнение задач.',
    manager: 'Набивайте заказы (Продажи с площадок) и ведите сделки (Продажи). Переводите готовый заказ в «Зарезервирован».',
    sales: 'Здесь сводка по вашим сделкам и задачам. Перетащите сделку на воронке — стадия поменяется.',
    warehouse: 'Раздел «Отгрузки»: заказы в статусе «Зарезервирован» собирайте и подтверждайте отгрузку (массово или по одному), выгружайте Excel с QR.',
    aus: 'Раздел «Каталог» и «Настройки»: импортируйте товары и остатки из МойСклад, ведите прайсы, площадки и склады.',
    finance: 'Раздел «Касса»: проверяйте транзакции по заказам, подтверждайте или отклоняйте, проставляйте комиссии.',
  };

  main.append(
    el(
      'div',
      { class: 'greeting-card' },
      el('div', { class: 'greeting-text' }, greeting(me.name)),
      el('div', { class: 'greeting-sub' }, tipsForRole[me.role] || 'Откройте боковое меню — там все разделы.'),
    ),
  );

  const container = el('div');
  main.append(container);

  // Дашборд под роль: склад — отгрузки, АУС — каталог, остальные — CRM-метрики.
  try {
    if (me.role === 'warehouse') {
      await renderWarehouseDashboard(container);
    } else if (me.role === 'aus') {
      await renderAusDashboard(container);
    } else if (me.role === 'finance') {
      await renderFinanceDashboard(container);
    } else if (me.role === 'manager') {
      // Маркетплейс-менеджер (Avito/WB/Ozon/ЯМ): дашборд про его заказы,
      // без нерелевантных CRM-метрик (компании/контакты/лиды/сделки/воронка).
      await renderMarketplaceManagerDashboard(container, me);
    } else {
      const stats = await api.dashboard();
      renderDashboardContent(container, stats, me);
    }
  } catch (e) {
    container.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
  }
}

// Дашборд склада: заказы к отгрузке на ближайшую дату.
async function renderWarehouseDashboard(container) {
  const r = await api.readyToShip();
  const orders = r.data || [];
  const nextDate = r.next_shipping_date
    ? new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(new Date(r.next_shipping_date)) + ' МСК'
    : '—';
  const needQr = orders.filter((o) => o.marketplace === 'Avito' && o.payment_method === 'avito_delivery' && !o.shipment_qr).length;
  container.append(
    el('div', { class: 'dashboard-grid' },
      statCard('К отгрузке', orders.length, 'заказов в статусе «Зарезервирован»'),
      statCard('Ближайшая отгрузка', nextDate),
      statCard('Без QR', needQr, needQr ? 'Avito-доставка без QR-кода' : 'все QR на месте'),
    ),
    el('div', { class: 'today-card card' },
      el('h3', { style: { margin: '0 0 8px' } }, 'Что делать'),
      el('ul', { class: 'today-list' },
        el('li', {}, '1. Откройте раздел «Отгрузки»'),
        el('li', {}, '2. Выгрузите заказы в Excel (с QR-кодами)'),
        el('li', {}, '3. Соберите и подтвердите отгрузку — заказы уйдут в «Отгружен», менеджеры получат уведомление'),
      ),
    ),
  );
}

// Дашборд АУС: состояние каталога и учётной системы.
async function renderAusDashboard(container) {
  let total = 0;
  try {
    const r = await api.list('products', { limit: 1 });
    total = r.pagination?.total ?? 0;
  } catch { /* ignore */ }
  const lastStock = localStorage.getItem('last_stock_refresh') || '—';
  container.append(
    el('div', { class: 'dashboard-grid' },
      statCard('Товаров в каталоге', total),
      statCard('Остатки обновлены', lastStock),
    ),
    el('div', { class: 'today-card card' },
      el('h3', { style: { margin: '0 0 8px' } }, 'Что делать'),
      el('ul', { class: 'today-list' },
        el('li', {}, '1. «Настройки» → сохраните токен МойСклад (один раз)'),
        el('li', {}, '2. «Каталог» → Импорт из МойСклад (товары), 🔄 Остатки, 🏬 Склады'),
        el('li', {}, '3. Ведите прайсы по площадкам и настройку складов'),
      ),
    ),
  );
}

// Дашборд финансиста: транзакции кассы на подтверждение (заглушка до полной кассы #9).
async function renderFinanceDashboard(container) {
  container.append(
    el('div', { class: 'today-card card' },
      el('h3', { style: { margin: '0 0 8px' } }, 'Касса'),
      el('p', {}, 'Откройте раздел «Касса» — там транзакции по заказам, комиссии и подтверждение прихода/расхода.'),
    ),
  );
}

// Дашборд менеджера маркетплейсов: только «мои заказы». CRM-модуль (компании/
// контакты/лиды/сделки/воронка/конверсия) для него всегда пуст — не показываем
// нули, не отвлекаем.
async function renderMarketplaceManagerDashboard(container, me) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const [stats, insights, daily] = await Promise.all([
    api.dashboard().catch(() => null),
    api.insights({ period: 'month' }).catch(() => null),
    api.dailySales({ date: today, manager_id: '' }).catch(() => null),
  ]);

  const orders = stats?.orders || { by_status: [], total: 0, total_amount: 0 };
  const activities = stats?.activities || { upcoming: 0, overdue: 0 };
  const todaySummary = daily?.summary || { orders: 0, revenue: 0, avg_check: 0, cancelled: 0 };
  const byStatus = new Map((orders.by_status || []).map((r) => [r.status, r]));
  const cnt = (s) => byStatus.get(s)?.count || 0;
  const inWork = cnt('new') + cnt('processing') + cnt('waiting');
  const reservedCnt = cnt('reserved');

  // «Что делать сейчас»: задачи, свежие заказы, к отгрузке.
  const todayItems = [];
  if (activities.overdue > 0) todayItems.push(`⚠️ ${activities.overdue} просроченных задач`);
  if (activities.upcoming > 0) todayItems.push(`📋 ${activities.upcoming} задач в работе`);
  if (todaySummary.orders > 0) {
    todayItems.push(`💰 Сегодня: ${todaySummary.orders} заказов, выручка ${fmtMoney(todaySummary.revenue)}`);
  }
  if (reservedCnt > 0) todayItems.push(`📦 ${reservedCnt} заказов ждут отгрузки`);
  if (inWork > 0) todayItems.push(`🛠 ${inWork} заказов в работе`);
  if (todayItems.length === 0) todayItems.push('✨ Всё под контролем. Хорошо поработать!');

  container.append(
    el('div', { class: 'today-card card' },
      el('h3', { style: { margin: '0 0 8px' } }, 'Сегодня'),
      el('ul', { class: 'today-list' }, ...todayItems.map((t) => el('li', {}, t))),
    ),
  );

  // Мой день: 4 карточки.
  container.append(
    el('div', { class: 'dashboard-section' }, el('h3', {}, 'Мой день')),
    el('div', { class: 'dashboard-grid' },
      statCard('Заказов за сегодня', todaySummary.orders, 'без отменённых'),
      statCard('Выручка за сегодня', fmtMoney(todaySummary.revenue)),
      statCard('Средний чек', fmtMoney(todaySummary.avg_check)),
      statCard('Отменено сегодня', todaySummary.cancelled, 'заказов'),
    ),
  );

  // Общие «мои заказы»: скольким уделить внимание.
  container.append(
    el('div', { class: 'dashboard-section' }, el('h3', {}, 'Мои заказы всего')),
    el('div', { class: 'dashboard-grid' },
      statCard('Всего заказов', orders.total),
      statCard('Общая выручка', fmtMoney(orders.total_amount), 'без отменённых'),
      statCard('К отгрузке', reservedCnt, 'зарезервировано'),
      statCard('В работе', inWork, 'новых/в процессе/ожидание'),
    ),
  );

  // Что продал сегодня — топ товаров (уже отфильтрован по scope менеджера).
  const topProducts = daily?.top_products || [];
  if (topProducts.length) {
    const tpBody = el('tbody', {});
    for (const p of topProducts) {
      tpBody.append(el('tr', {},
        el('td', {}, p.name || '—'),
        el('td', { style: { color: 'var(--text-muted)' } }, p.sku || ''),
        el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${p.qty} шт`)));
    }
    container.append(
      el('div', { class: 'dashboard-section' },
        el('h3', {}, 'Что я продал сегодня (топ-10)'),
        el('div', { class: 'card' }, el('table', { class: 'table' }, tpBody)),
      ),
    );
  }

  // Динамика продаж за 30 дней (мои).
  const series = insights?.series || [];
  const periodTotals = insights?.period_totals || { orders: 0, revenue: 0, cancelled: 0 };
  container.append(
    el('div', { class: 'dashboard-section' },
      el('h3', {}, 'Мои продажи за 30 дней'),
      el('div', { class: 'card' },
        el('div', { class: 'page-subtitle' },
          `За период: ${periodTotals.orders} заказов, выручка ${fmtMoney(periodTotals.revenue)}, отменено ${periodTotals.cancelled}`),
        renderTimeSeries(series),
      ),
    ),
  );

  // Заказы по статусам — компактный распред всех моих.
  const ordersByStatus = (orders.by_status || []).map((r) => ({
    label: tr('order_status', r.status),
    count: r.count,
  }));
  if (ordersByStatus.length) {
    container.append(
      el('div', { class: 'dashboard-section' },
        el('h3', {}, 'Мои заказы по статусам'),
        el('div', { class: 'card' }, ...renderBars(ordersByStatus, 'label', 'count')),
      ),
    );
  }
}

function renderDashboardContent(container, stats, me) {
  const { totals, deals, activities, leads } = stats;

  // Карточка «Сегодня» — что требует внимания прямо сейчас.
  const todayItems = [];
  if (activities.overdue > 0) todayItems.push(`⚠️ ${activities.overdue} просроченных задач`);
  if (activities.upcoming > 0) todayItems.push(`📋 ${activities.upcoming} задач в работе`);
  if (deals.weighted_pipeline_value > 0) {
    todayItems.push(`💰 Ожидаемая выручка: ${fmtMoney(deals.weighted_pipeline_value)}`);
  }
  if (todayItems.length === 0) todayItems.push('✨ Срочных дел нет. Хорошо поработать сегодня!');

  container.append(
    el(
      'div',
      { class: 'today-card card' },
      el('h3', { style: { margin: '0 0 8px' } }, 'Сегодня'),
      el(
        'ul',
        { class: 'today-list' },
        ...todayItems.map((t) => el('li', {}, t)),
      ),
    ),
  );

  // Детальные продажи за день + по менеджеру — для админа/РОПа, самым верхом.
  if (['admin', 'rop'].includes(me.role)) {
    const dailyContainer = el('div');
    container.append(dailyContainer);
    renderDailySales(dailyContainer, me).catch((e) => console.error('[daily-sales]', e));
  }

  container.append(
    el(
      'div',
      { class: 'dashboard-grid' },
      statCard('Компании', totals.companies),
      statCard('Контакты', totals.contacts),
      statCard('Лиды', totals.leads),
      statCard('Сделки', totals.deals),
    ),
    el(
      'div',
      { class: 'dashboard-grid' },
      statCard('Сумма воронки', fmtMoney(deals.pipeline_value)),
      statCard('Взвешенная воронка', fmtMoney(deals.weighted_pipeline_value)),
      statCard(
        'Конверсия',
        `${(deals.win_rate * 100).toFixed(0)}%`,
        `${deals.won.count} выигр. / ${deals.lost.count} проигр.`,
      ),
      statCard(
        'Задачи',
        `${activities.upcoming} в работе`,
        `${activities.overdue} просрочено`,
      ),
    ),
  );

  const leadsByStatus = (leads?.by_status || []).map((r) => ({
    label: tr('status', r.status),
    count: r.count,
  }));
  const dealsByStage = (deals?.by_stage || []).map((r) => ({
    label: tr('stage', r.stage),
    count: r.count,
  }));

  container.append(
    el(
      'div',
      { class: 'dashboard-section' },
      el('h3', {}, 'Лиды по статусу'),
      el('div', { class: 'card' }, ...renderBars(leadsByStatus, 'label', 'count')),
    ),
    el(
      'div',
      { class: 'dashboard-section' },
      el('h3', {}, 'Сделки по стадии'),
      el('div', { class: 'card' }, ...renderBars(dealsByStage, 'label', 'count')),
    ),
  );

  // Продажи с площадок (заказы) — для admin/rop/manager/sales.
  const orders = stats.orders;
  if (orders) {
    const ordersByStatus = (orders.by_status || []).map((r) => ({
      label: tr('order_status', r.status),
      count: r.count,
    }));
    container.append(
      el('div', { class: 'dashboard-grid' },
        statCard('Продажи с площадок', orders.total, 'всего заказов'),
        statCard('Сумма заказов', fmtMoney(orders.total_amount), 'без отменённых'),
        statCard('К отгрузке', (orders.by_status || []).find((r) => r.status === 'reserved')?.count || 0, 'в статусе «Зарезервирован»'),
        statCard('Отгружено', (orders.by_status || []).find((r) => r.status === 'shipped')?.count || 0),
      ),
      el('div', { class: 'dashboard-section' },
        el('h3', {}, 'Продажи с площадок по статусу'),
        el('div', { class: 'card' }, ...renderBars(ordersByStatus, 'label', 'count')),
      ),
    );

    // Расширенные виджеты: динамика продаж, топ менеджеров, уценки без цены.
    // Грузятся отдельным запросом — заглушка пока, чтобы не задерживать первый рендер.
    const insightsContainer = el('div');
    container.append(insightsContainer);
    renderInsightsWidgets(insightsContainer, me).catch((e) => {
      console.error('[dashboard insights]', e);
    });
  }
}

// График-бары для временной серии (по дням/неделям).
function renderTimeSeries(rows) {
  if (!rows.length) return el('div', { class: 'empty' }, 'Нет данных за период');
  const max = Math.max(...rows.map((r) => r.amount || 0)) || 1;
  const labelFmt = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  };
  // Простой SVG-график не делаем — bar-row из существующих стилей выглядит понятно.
  return el('div', {},
    ...rows.map((r) => el('div', { class: 'bar-row' },
      el('div', { class: 'name' }, labelFmt(r.bucket)),
      el('div', { class: 'bar' },
        el('div', { style: { width: `${((r.amount || 0) / max) * 100}%` } }),
      ),
      el('div', { class: 'count' }, fmtMoney(r.amount || 0)),
    )),
  );
}

async function renderInsightsWidgets(container, me) {
  const periodSel = el('select', {},
    el('option', { value: 'week' }, 'Неделя'),
    el('option', { value: 'month', selected: true }, 'Месяц'),
    el('option', { value: 'quarter' }, 'Квартал'),
  );

  const seriesArea = el('div');
  const totalsLine = el('div', { class: 'page-subtitle' });
  const topArea = el('div');
  const markdownArea = el('div');

  async function load() {
    seriesArea.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      const r = await api.insights({ period: periodSel.value });
      clear(seriesArea);
      seriesArea.append(renderTimeSeries(r.series || []));
      const t = r.period_totals || {};
      totalsLine.textContent = `За период: ${t.orders || 0} заказ(ов), выручка ${fmtMoney(t.revenue || 0)}, отменено ${t.cancelled || 0}`;

      clear(topArea);
      if ((r.top_managers || []).length === 0) {
        topArea.append(el('div', { class: 'empty' }, 'Нет данных'));
      } else {
        const maxRev = Math.max(...r.top_managers.map((m) => m.revenue || 0)) || 1;
        for (const m of r.top_managers) {
          topArea.append(el('div', { class: 'bar-row' },
            el('div', { class: 'name' }, m.name),
            el('div', { class: 'bar' },
              el('div', { style: { width: `${((m.revenue || 0) / maxRev) * 100}%` } }),
            ),
            el('div', { class: 'count' }, `${fmtMoney(m.revenue || 0)} (${m.orders})`),
          ));
        }
      }

      clear(markdownArea);
      const md = r.markdown_no_price || {};
      if ((md.count || 0) === 0) {
        markdownArea.append(el('div', { class: 'empty' }, 'Все уценки имеют цену 👍'));
      } else {
        const link = el('a', { href: '#/products?markdown=1' }, `Открыть каталог уценок (${md.count})`);
        markdownArea.append(
          el('div', { style: { marginBottom: '8px' } },
            el('b', {}, `🏷️ Без цены: ${md.count}`),
            ' — ', link,
          ),
          el('ul', { style: { paddingLeft: '20px', margin: '4px 0' } },
            ...(md.sample || []).slice(0, 5).map((p) => el('li', {},
              `${p.name}`, p.sku ? ` (${p.sku})` : '', ` · ${p.stock || 0} шт`,
            )),
          ),
        );
      }
    } catch (e) {
      clear(seriesArea);
      seriesArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  periodSel.addEventListener('change', load);

  container.append(
    el('div', { class: 'dashboard-section' },
      el('h3', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
        'Динамика продаж',
        el('span', { style: { fontSize: '13px', fontWeight: 400 } }, periodSel),
      ),
      el('div', { class: 'card' },
        totalsLine,
        seriesArea,
      ),
    ),
    el('div', { class: 'dashboard-section' },
      el('h3', {}, 'Топ менеджеров за период'),
      el('div', { class: 'card' }, topArea),
    ),
    me.role === 'admin' ? el('div', { class: 'dashboard-section' },
      el('h3', {}, 'Уценки без цены'),
      el('div', { class: 'card' }, markdownArea),
    ) : null,
  );

  await load();
}

// Детальные продажи за день + по конкретному менеджеру (для admin/rop).
async function renderDailySales(container, me) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const dateI = el('input', { type: 'date', value: today, max: today, style: { padding: '4px 6px' } });
  const mgrSel = el('select', {}, el('option', { value: '' }, 'Все менеджеры'));
  let managersLoaded = false;

  const summaryArea = el('div', { class: 'dashboard-grid' });
  const breakdownArea = el('div');
  const ordersArea = el('div');

  async function load() {
    clear(summaryArea);
    clear(breakdownArea);
    ordersArea.innerHTML = '<div class="empty">Загрузка…</div>';
    let r;
    try { r = await api.dailySales({ date: dateI.value, manager_id: mgrSel.value || '' }); }
    catch (e) { clear(ordersArea); ordersArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`)); return; }

    if (!managersLoaded) {
      for (const m of (r.managers || [])) mgrSel.append(el('option', { value: String(m.id) }, m.name));
      managersLoaded = true;
    }

    const s = r.summary || {};
    summaryArea.append(
      statCard('Заказов за день', s.orders || 0, 'без отменённых'),
      statCard('Выручка', fmtMoney(s.revenue || 0), 'без отменённых'),
      statCard('Средний чек', fmtMoney(s.avg_check || 0)),
      statCard('Отменено', s.cancelled || 0, 'заказов'),
    );

    // Разбивки: по менеджерам (только когда «Все»), по площадкам, что продано.
    const cols = [];
    if (!mgrSel.value) {
      const byMgr = (r.by_manager || [])
        .filter((m) => (m.orders || 0) > 0 || (m.revenue || 0) > 0)
        .map((m) => ({ label: m.name || '—', count: Math.round(m.revenue || 0) }));
      cols.push(el('div', { class: 'dashboard-section' },
        el('h4', {}, 'По менеджерам (выручка)'),
        el('div', { class: 'card' }, ...renderBars(byMgr, 'label', 'count'))));
    }
    const byMkt = (r.by_marketplace || []).map((m) => ({ label: m.marketplace || '—', count: Math.round(m.amount || 0) }));
    cols.push(el('div', { class: 'dashboard-section' },
      el('h4', {}, 'По площадкам (выручка)'),
      el('div', { class: 'card' }, ...renderBars(byMkt, 'label', 'count'))));
    const tp = r.top_products || [];
    const tpBody = el('tbody', {});
    for (const p of tp) {
      tpBody.append(el('tr', {},
        el('td', {}, p.name || '—'),
        el('td', { style: { color: 'var(--text-muted)' } }, p.sku || ''),
        el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, `${p.qty} шт`)));
    }
    cols.push(el('div', { class: 'dashboard-section' },
      el('h4', {}, 'Что продано (топ-10)'),
      el('div', { class: 'card' }, tp.length ? el('table', { class: 'table' }, tpBody) : el('div', { class: 'empty' }, 'Продаж нет'))));
    breakdownArea.append(el('div', { class: 'dashboard-grid' }, ...cols));

    // Список заказов за день.
    clear(ordersArea);
    const rows = r.orders || [];
    if (!rows.length) { ordersArea.append(el('div', { class: 'empty' }, 'В этот день продаж не было')); return; }
    const tbody = el('tbody', {});
    for (const o of rows) {
      const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(o.created_at));
      tbody.append(el('tr', {},
        el('td', { style: { whiteSpace: 'nowrap' } }, time),
        el('td', {}, el('a', { href: `#/orders?id=${o.id}` }, `#${o.id}`)),
        el('td', {}, o.client_name || '—'),
        el('td', {}, o.marketplace || 'B2B'),
        el('td', {}, o.manager_name || '—'),
        el('td', {}, badge(o.status, 'order_status')),
        el('td', { style: { textAlign: 'right' } }, String(o.items_count || 0)),
        el('td', { style: { textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' } }, fmtMoney(o.total_amount, o.currency))));
    }
    ordersArea.append(el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Время'), el('th', {}, '№'), el('th', {}, 'Клиент'), el('th', {}, 'Площадка'),
        el('th', {}, 'Менеджер'), el('th', {}, 'Статус'), el('th', {}, 'Поз.'), el('th', {}, 'Сумма'))),
      tbody));
  }

  dateI.addEventListener('change', load);
  mgrSel.addEventListener('change', load);

  container.append(
    el('div', { class: 'dashboard-section' },
      el('h3', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
        '📊 Продажи за день',
        el('span', { style: { fontSize: '13px', fontWeight: 400 } }, dateI),
        el('span', { style: { fontSize: '13px', fontWeight: 400 } }, mgrSel)),
      summaryArea,
      breakdownArea,
      el('div', { class: 'card', style: { marginTop: '8px', overflowX: 'auto' } }, ordersArea)));
  await load();
}

function statCard(label, value, sub) {
  return el(
    'div',
    { class: 'stat-card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value),
    sub ? el('div', { class: 'sub' }, sub) : null,
  );
}

function renderBars(rows, labelKey, valueKey) {
  if (!rows.length) return [el('div', { class: 'empty' }, 'Нет данных')];
  const max = Math.max(...rows.map((r) => r[valueKey] || 0)) || 1;
  return rows.map((r) =>
    el(
      'div',
      { class: 'bar-row' },
      el('div', { class: 'name' }, r[labelKey]),
      el(
        'div',
        { class: 'bar' },
        el('div', { style: { width: `${((r[valueKey] || 0) / max) * 100}%` } }),
      ),
      el('div', { class: 'count' }, r[valueKey] || 0),
    ),
  );
}

// ============================================================
// Воронка (kanban)
// ============================================================

export async function renderPipeline(main) {
  await loadLookups();
  // Состояние фильтров воронки — переживает перерисовку body.
  const filters = { project_id: '' };
  const projectFilter = el('select', {
    onChange: (e) => { filters.project_id = e.target.value; renderPipelineBody(body, filters); },
  },
    ...projectOptions().map((o) => el('option', { value: o.value }, `Проект: ${o.label}`)),
  );
  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Воронка продаж'),
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        projectFilter,
        el(
          'button',
          {
            class: 'btn btn-primary',
            onClick: async () => {
              const cfg = RESOURCES.deals;
              const { node, getValues } = buildForm(cfg.form(false), {});
              await openModal('Новая сделка', node, {
                primaryLabel: 'Создать',
                size: 'lg',
                onSubmit: async () => {
                  await api.create('deals', getValues());
                  toast('Создано', 'success');
                  renderPipelineBody(body, filters);
                },
              });
            },
          },
          'Новая сделка',
        ),
      ),
    ),
  );
  const body = el('div');
  main.append(body);
  renderPipelineBody(body, filters);
}

async function renderPipelineBody(body, filters = {}) {
  clear(body);
  body.append(el('div', { class: 'loading' }, 'Загрузка…'));

  try {
    const q = filters.project_id ? { project_id: filters.project_id } : {};
    const [pipeline, deals] = await Promise.all([
      api.pipeline(q),
      api.list('deals', { limit: 200, ...q }),
    ]);
    clear(body);

    body.append(
      el(
        'div',
        { class: 'help-banner' },
        '💡 Перетаскивайте карточки между колонками, чтобы менять стадию сделки. Клик по карточке — открыть детали.',
      ),
    );

    const grid = el('div', { class: 'pipeline' });
    const reload = () => renderPipelineBody(body, filters);

    for (const stage of pipeline.stages) {
      const stageDeals = (deals.data || []).filter((d) => d.stage === stage.stage);
      const cardsWrap = el('div', { class: 'pipeline-cards' });
      const column = el(
        'div',
        {
          class: 'pipeline-column',
          'data-stage': stage.stage,
          onDragover: (e) => {
            e.preventDefault();
            column.classList.add('drop-target');
          },
          onDragleave: () => column.classList.remove('drop-target'),
          onDrop: async (e) => {
            e.preventDefault();
            column.classList.remove('drop-target');
            const dealId = Number(e.dataTransfer.getData('text/plain'));
            const sourceStage = e.dataTransfer.getData('source-stage');
            if (!dealId || sourceStage === stage.stage) return;
            try {
              if (stage.stage === 'won') await api.winDeal(dealId);
              else if (stage.stage === 'lost') {
                const reason = prompt('Причина проигрыша (необязательно):') || '';
                await api.loseDeal(dealId, reason);
              } else {
                await api.update('deals', dealId, { stage: stage.stage });
              }
              toast(`Переведено в «${tr('stage', stage.stage)}»`, 'success');
              reload();
            } catch (err) {
              toast(err.message || 'Не удалось перевести', 'error');
            }
          },
        },
        el(
          'div',
          { class: 'pipeline-column-header' },
          el('span', {}, tr('stage', stage.stage)),
          el('span', {}, `${stage.count} · ${fmtMoney(stage.total_amount)}`),
        ),
        cardsWrap,
      );

      if (stageDeals.length === 0) {
        cardsWrap.append(el('div', { class: 'pipeline-empty' }, 'Пусто'));
      } else {
        for (const d of stageDeals) {
          cardsWrap.append(
            el(
              'div',
              {
                class: 'pipeline-card',
                draggable: 'true',
                onDragstart: (e) => {
                  e.dataTransfer.setData('text/plain', String(d.id));
                  e.dataTransfer.setData('source-stage', d.stage);
                  e.dataTransfer.effectAllowed = 'move';
                  e.currentTarget.classList.add('dragging');
                },
                onDragend: (e) => e.currentTarget.classList.remove('dragging'),
                onClick: () => openDealEdit(d, reload),
              },
              el('div', { class: 'title' }, d.title),
              projectSticker(d),
              el(
                'div',
                { class: 'meta' },
                fmtMoney(d.amount, d.currency),
                ' · ',
                d.probability + '%',
              ),
              el('div', { class: 'meta' }, d.company_name || companyName(d.company_id) || '—'),
              d.expected_close_date
                ? el('div', { class: 'meta' }, '📅 ' + fmtDate(d.expected_close_date))
                : null,
            ),
          );
        }
      }
      grid.append(column);
    }
    body.append(grid);
    body.append(
      el(
        'div',
        { class: 'card pipeline-totals' },
        el('strong', {}, 'Сумма воронки: '),
        fmtMoney(pipeline.pipeline_value),
        ' · ',
        el('strong', {}, 'Взвешенная: '),
        fmtMoney(pipeline.weighted_pipeline_value),
      ),
    );
  } catch (e) {
    clear(body);
    body.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
  }
}

async function openDealEdit(deal, onSaved) {
  const cfg = RESOURCES.deals;
  const { node, getValues } = buildForm(cfg.form(true), deal);
  await openModal(`Сделка: ${deal.title}`, node, {
    primaryLabel: 'Сохранить',
    size: 'lg',
    onSubmit: async () => {
      await api.update('deals', deal.id, getValues());
      toast('Сохранено', 'success');
      onSaved?.();
    },
  });
}

// ============================================================
// Настройки: API-токены и вебхуки
// ============================================================

export async function renderIntegrations(main) {
  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Настройки'),
        el('div', { class: 'page-subtitle' }, 'Подключайте внешние сайты, мессенджеры, маркетплейсы — заявки и заказы будут падать прямо в CRM'),
      ),
    ),
  );

  main.append(el('div', { class: 'help-row' }, helpButton('integrations')));

  const msTokenArea = el('div', { class: 'integration-section' });
  const msSyncArea = el('div', { class: 'integration-section' });
  const maxBotArea = el('div', { class: 'integration-section' });
  const bannersArea = el('div', { class: 'integration-section' });
  const projectsArea = el('div', { class: 'integration-section' });
  const marketplacesArea = el('div', { class: 'integration-section' });
  const deliveryArea = el('div', { class: 'integration-section' });
  const cancelReasonsArea = el('div', { class: 'integration-section' });
  const warehousesArea = el('div', { class: 'integration-section' });
  const tokensArea = el('div', { class: 'integration-section' });
  const webhooksArea = el('div', { class: 'integration-section' });
  const docsArea = el('div', { class: 'integration-section' });
  const productionArea = el('div', { class: 'integration-section' });

  main.append(msTokenArea, msSyncArea, maxBotArea, bannersArea, projectsArea, marketplacesArea, deliveryArea, cancelReasonsArea, warehousesArea, productionArea, tokensArea, webhooksArea, docsArea);

  await renderMoyskladTokenSection(msTokenArea);
  await renderMoyskladSyncSection(msSyncArea);
  await renderMaxBotSection(maxBotArea);
  await renderNoticeBannersSection(bannersArea);
  await renderProjectsSection(projectsArea);
  await renderProductionSettingsSection(productionArea);
  await renderMarketplacesSection(marketplacesArea);
  await renderDeliveryMethodsSection(deliveryArea);
  await renderListSettingSection(cancelReasonsArea, {
    title: '🚫 Причины отмены заказа',
    subtitle: 'Эти причины предлагаются при отмене заказа.',
    load: () => api.cancelReasonsList().then((r) => r.cancel_reasons || []),
    save: (list) => api.setCancelReasons(list),
    placeholder: 'Новая причина отмены',
  });
  await renderWarehousesSection(warehousesArea);
  await renderTokensSection(tokensArea);
  await renderWebhooksSection(webhooksArea);
  renderDocsSection(docsArea);

  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role === 'admin') {
    const migrationArea = el('div', { class: 'integration-section' });
    const dangerArea = el('div', { class: 'integration-section' });
    main.append(migrationArea, dangerArea);
    renderDbMigrationSection(migrationArea);
    renderDangerZoneSection(dangerArea);
  }
}

// Одноразовая секция миграции БД в другой Supabase-проект (или любой Postgres).
// Порядок: 1) Скачать бэкап (страховка), 2) Создать пустой target, 3) Переключить
// DATABASE_URL (я делаю в Vercel), 4) Вернуться сюда и запустить прямую миграцию.
// После успешного переезда — этот код и эндпоинт снесу.
function renderDbMigrationSection(area) {
  clear(area);
  const targetInput = el('input', {
    type: 'text',
    placeholder: 'postgresql://postgres.xxx:PWD@aws-...pooler.supabase.com:6543/postgres',
    style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' },
  });
  const wipeChk = el('input', { type: 'checkbox' });
  const dryRunChk = el('input', { type: 'checkbox', checked: true });
  const reportArea = el('pre', { style: { background: '#f9fafb', padding: '8px', fontSize: '11px', maxHeight: '400px', overflow: 'auto', whiteSpace: 'pre-wrap' } });

  async function runMigration() {
    const url = targetInput.value.trim();
    if (!url.startsWith('postgres')) { toast('Connection string должен начинаться с postgres:// или postgresql://', 'error'); return; }
    const dry = dryRunChk.checked;
    const wipe = wipeChk.checked;
    if (!dry && !confirm(`ЗАПУСТИТЬ реальную миграцию?${wipe ? '\n\n⚠️ WIPE: сначала очистит все данные на целевой БД!' : ''}`)) return;
    reportArea.textContent = 'Миграция началась, дождитесь ответа (может занять до 60 секунд)…';
    try {
      const r = await api.migrateDb(url, { wipe, dry_run: dry });
      reportArea.textContent = JSON.stringify(r, null, 2);
      toast(r.ok ? (dry ? 'Dry-run прошёл' : 'Миграция завершена') : `Ошибки: ${r.errors?.length || 0}`, r.ok ? 'success' : 'error');
    } catch (e) {
      reportArea.textContent = `Ошибка: ${e.message}`;
      toast(e.message, 'error');
    }
  }

  area.append(
    el('div', { class: 'section-header' }, el('h2', {}, '🔀 Миграция БД (одноразовая)')),
    el('p', { class: 'help-banner', style: { background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a' } },
      'Одноразовая утилита для переноса на другой Supabase (или любой Postgres). Порядок: ',
      el('b', {}, '1) '), 'Скачай бэкап-страховку кнопкой ниже. ',
      el('b', {}, '2) '), 'Создай пустой target-проект (тот же регион `eu-central-1`). ',
      el('b', {}, '3) '), 'Скинь мне connection string — я сначала прогоню schema через ensureInitialized (переключу DATABASE_URL и redeploy), а потом ',
      el('b', {}, '4) '), 'здесь вставишь connection string и запустишь миграцию данных. ',
      el('b', {}, 'Начни с dry-run — покажет что бы залилось без изменений.'),
    ),
    el('div', { style: { marginTop: '12px' } },
      el('a', {
        href: '#',
        onClick: async (e) => {
          e.preventDefault();
          try {
            const res = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const cd = res.headers.get('content-disposition') || '';
            const name = cd.match(/filename="(.+)"/)?.[1] || 'crm-backup.json';
            const dl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = dl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(dl);
            toast('Бэкап скачан', 'success');
          } catch (err) { toast(err.message, 'error'); }
        },
        style: { display: 'inline-block', padding: '6px 12px', background: '#3b82f6', color: '#fff', borderRadius: '4px', textDecoration: 'none' },
      }, '⬇️ Скачать бэкап-страховку (JSON, с паролями)'),
    ),
    el('div', { style: { marginTop: '16px' } },
      el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Target connection string:'),
      targetInput,
    ),
    el('div', { style: { marginTop: '8px', display: 'flex', gap: '16px', alignItems: 'center' } },
      el('label', { style: { fontSize: '13px' } }, dryRunChk, ' Dry-run (только показать, не заливать)'),
      el('label', { style: { fontSize: '13px' } }, wipeChk, ' Очистить target перед заливкой'),
    ),
    el('div', { style: { marginTop: '8px' } },
      el('button', { class: 'btn btn-primary', onClick: runMigration }, '🚀 Мигрировать'),
    ),
    el('div', { style: { marginTop: '12px' } }, el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Отчёт:'), reportArea),
  );
}

// Опасная зона: предзапусковая очистка тест-данных. Только админ.
function renderDangerZoneSection(area) {
  clear(area);
  area.append(
    el('div', { class: 'section-header' }, el('h2', { style: { color: '#b91c1c' } }, '⚠️ Опасная зона')),
    el('p', { class: 'help-banner', style: { background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d' } },
      'Кнопка ниже снесёт ВСЕ заказы, позиции, платежи, возвраты, очередь МС и уведомления. ',
      'Сохраняются: пользователи, каталог, прайсы, настройки, токены, лиды/сделки/контакты. ',
      'Используется перед боевым запуском, чтобы стартовать с чистого листа.',
    ),
    el('button', {
      class: 'btn btn-danger',
      onClick: async () => {
        const phrase = prompt('Это удалит ВСЕ заказы, платежи, возвраты, очередь МС и уведомления.\n\nДействие необратимо.\n\nДля подтверждения введите слово УДАЛИТЬ заглавными:');
        if (!phrase || phrase.trim().toUpperCase() !== 'УДАЛИТЬ') {
          if (phrase) toast('Не подтверждено — ввели неверное слово', 'error');
          return;
        }
        try {
          const r = await api.wipeOperational();
          const lines = Object.entries(r.deleted || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
          toast('Очистка выполнена', 'success');
          alert(`Готово. Удалено:\n\n${lines}\n\nОбновите страницу.`);
        } catch (e) { toast(e.message, 'error'); }
      },
    }, '🗑️ Очистить тестовые данные (заказы, платежи, возвраты)'),
  );
}

// МС-интеграция: списание/приход. Этап 1 — инициализация и видимость очереди.
async function renderMoyskladSyncSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') return;
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🔁 МойСклад — синхронизация документов')));
  area.append(el('p', {},
    'Записывает в МС: отгрузки, возвраты, потери, резервы. Работает асинхронно через очередь — ' +
    'если МС упал, задачи долетят позже. Подробности — в карте сценариев.'));

  const statusBox = el('div', { class: 'card', style: { marginTop: '10px' } });
  const controlsBox = el('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } });
  const warnBox = el('div');
  const jobsBox = el('div', { class: 'card', style: { marginTop: '14px' } });
  area.append(statusBox, controlsBox, warnBox, jobsBox);

  function actionLabel(job) {
    const a = job.action;
    const p = job.payload || {};
    if (a === 'customer_order.upsert') {
      const isUndo = p.undo_of ? ' (откат)' : '';
      return p.reserve_mode === 'full'
        ? '🔒 Резерв' + isUndo
        : '🔓 Снятие резерва' + isUndo;
    }
    const map = {
      'demand.create': '🚚 Отгрузка',
      'demand.delete': '↩️ Откат отгрузки',
      'customerreturn.create': '↩️ Возврат от покупателя',
      'loss.create': '❌ Списание (потеря/брак)',
      'markdown.create': '🏷️ Уценка (новый товар + приход)',
      'markdown.undo': '↩️ Откат уценки',
    };
    return map[a] || a;
  }

  function jobStatusBadge(s) {
    const map = {
      pending: ['Ожидает', '#fef3c7', '#92400e'],
      running: ['Выполняется', '#dbeafe', '#1e40af'],
      done: ['Готово', '#dcfce7', '#166534'],
      failed: ['Сбой', '#fee2e2', '#991b1b'],
    };
    const [label, bg, fg] = map[s] || [s, '#eee', '#444'];
    return el('span', { style: { background: bg, color: fg, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } }, label);
  }

  async function refreshJobs() {
    clear(jobsBox);
    jobsBox.append(el('div', { class: 'section-header' },
      el('h3', { style: { margin: 0, fontSize: '14px' } }, '📋 Лог последних МС-операций'),
      el('button', {
        class: 'btn btn-sm',
        onClick: () => refresh(),
      }, '🔄 Обновить'),
    ));

    let data;
    try { data = await api.msListJobs({ limit: '50' }); }
    catch (e) { jobsBox.append(el('div', {}, 'Не удалось загрузить лог: ' + e.message)); return; }

    if (!data.rows?.length) {
      jobsBox.append(el('div', { style: { padding: '20px', color: 'var(--text-muted)', textAlign: 'center' } },
        'Пока не было ни одной операции. Зарезервируйте заказ — здесь появится первая запись.'));
      return;
    }

    const head = el('tr', {},
      el('th', {}, '№'),
      el('th', {}, 'Когда'),
      el('th', {}, 'Действие'),
      el('th', {}, 'Заказ'),
      el('th', {}, 'Статус'),
      el('th', {}, 'Попытки'),
      el('th', {}, 'МС-документ'),
      el('th', {}, 'Ошибка'),
    );
    const tbody = el('tbody', {}, ...data.rows.map((j) => {
      // Retry показываем во всех состояниях кроме done. Пользователь может
      // вручную «пнуть» задачу: pending с retries (в backoff после ошибки),
      // running (зависшая после крэша лямбды), failed (выработала попытки).
      const retryBtn = j.status !== 'done'
        ? el('button', {
            class: 'btn btn-xs',
            title: 'Сбросить attempts и запустить сейчас',
            onClick: async () => {
              try { await api.msRetryJob(j.id); toast('Повторяем…', 'success'); await refresh(); }
              catch (e) { toast(e.message, 'error'); }
            },
          }, '🔄')
        : null;
      // «Отменить» — для done операций которые умеют откат: customer_order.upsert
      // (резерв/снятие) и markdown.create (уценка).
      const canUndo = j.status === 'done' && !j.payload?.undo_of &&
        (j.action === 'customer_order.upsert' || j.action === 'markdown.create');
      const undoBtn = canUndo
        ? el('button', {
            class: 'btn btn-xs',
            title: 'Откатить это действие',
            onClick: async () => {
              let msg;
              if (j.action === 'customer_order.upsert') {
                const wasReserve = j.payload?.reserve_mode === 'full';
                msg = wasReserve
                  ? 'Снять резерв в МС? (статус заказа в CRM не изменится)'
                  : 'Восстановить резерв в МС? (статус заказа в CRM не изменится)';
              } else {
                msg = 'Откатить уценку? Уценочный возврат удалится из МС, новые товары будут архивированы, заказ вернётся в «Ждёт обработки» — можно выбрать другое решение.';
              }
              if (!(await confirm(msg))) return;
              try { await api.msUndoJob(j.id); toast('Откат поставлен в очередь', 'success'); await refresh(); }
              catch (e) { toast(e.message, 'error'); }
            },
          }, '↩')
        : null;
      return el('tr', {},
        el('td', {}, '#' + j.id),
        el('td', { style: { whiteSpace: 'nowrap', fontSize: '12px' } }, fmtDateTime(j.updated_at || j.created_at)),
        el('td', {}, actionLabel(j)),
        el('td', {}, j.order_id ? `#${j.order_id}${j.order_reference ? ' / ' + j.order_reference : ''}` : '—'),
        el('td', {}, jobStatusBadge(j.status), ' ', retryBtn, ' ', undoBtn),
        el('td', {}, String(j.attempts)),
        el('td', { style: { fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' } }, j.ms_document_id || '—'),
        el('td', { style: { fontSize: '11px', color: 'var(--danger)', maxWidth: '300px' } }, j.last_error || '—'),
      );
    }));
    jobsBox.append(el('div', { class: 'table-wrap', style: { marginTop: '8px' } },
      el('table', { class: 'data' }, el('thead', {}, head), tbody)));
  }

  async function refresh() {
    clear(statusBox);
    clear(controlsBox);
    clear(warnBox);
    let st;
    try { st = await api.msStatus(); }
    catch (e) { statusBox.append(el('div', {}, 'Не удалось загрузить статус: ' + e.message)); return; }

    const storeNames = Object.keys(st.store_map || {});
    const ready = !!(st.has_token && st.organization_id && st.counterparty_id && storeNames.length);

    statusBox.append(
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Токен МС'),
        el('div', {}, st.has_token ? '✓ задан' : '❌ не задан (см. секцию выше)'),
        el('div', { class: 'k' }, 'Инициализация'),
        el('div', {}, st.init_completed_at ? `✓ ${fmtDateTime(st.init_completed_at)}` : '— не выполнена'),
        el('div', { class: 'k' }, 'Организация (uuid)'),
        el('div', {}, st.organization_id || '—'),
        el('div', { class: 'k' }, 'Контрагент (uuid)'),
        el('div', {}, st.counterparty_id || '—'),
        el('div', { class: 'k' }, 'Склады из МС'),
        el('div', {}, storeNames.length ? storeNames.join(', ') : '—'),
        el('div', { class: 'k' }, 'Очередь'),
        el('div', {},
          `pending: ${st.job_counts?.pending || 0}, running: ${st.job_counts?.running || 0}, ` +
          `done: ${st.job_counts?.done || 0}, failed: ${st.job_counts?.failed || 0}`,
        ),
      ),
    );

    const cpInput = el('input', { type: 'text', value: 'Розничный покупатель', placeholder: 'Имя контрагента в МС' });
    const initBtn = el('button', {
      class: 'btn btn-primary btn-sm',
      onClick: async () => {
        if (!st.has_token) { toast('Сначала сохраните токен МС в секции выше.', 'error'); return; }
        try {
          await api.msInit({ counterparty_name: cpInput.value.trim() || 'Розничный покупатель' });
          toast('Инициализация выполнена', 'success');
          await refresh();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, ready ? '🔄 Переинициализировать' : '🚀 Инициализировать');

    const runBtn = el('button', {
      class: 'btn btn-sm',
      onClick: async () => {
        try {
          const r = await api.msRunNow();
          toast(`Обработано задач: ${r.processed}`, 'success');
          await refresh();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, '▶ Запустить очередь сейчас');

    controlsBox.append(
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Контрагент:', cpInput),
      initBtn,
      runBtn,
    );

    if (st.job_counts?.failed) {
      warnBox.append(el('div', { class: 'help-banner', style: { marginTop: '10px' } },
        `⚠️ В очереди ${st.job_counts.failed} неудачных задач. См. лог ниже — у каждой кнопка повтора.`));
    }

    await refreshJobs();
  }

  await refresh();
}

// Токен МойСклад: хранится в БД (шифрованно), используется для импорта и автообновления остатков.
async function renderMoyskladTokenSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (!['admin', 'aus'].includes(me.role)) return;
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🔑 Токен МойСклад')));

  let status = { hasToken: false };
  try {
    status = await api.moyskladTokenStatus();
  } catch {
    /* нет статуса */
  }
  area.append(
    el('p', { class: 'page-subtitle' },
      status.hasToken
        ? (status.fromEnv ? 'Токен задан через переменную окружения. Можно сохранить свой ниже.' : '✅ Токен сохранён в базе. Остатки обновляются автоматически при входе.')
        : 'Введите Bearer-токен МойСклад — он сохранится шифрованно и будет использоваться для импорта и автообновления остатков.'),
  );
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен МойСклад' });
  const st = el('span', { class: 'save-status' });
  const saveBtn = el('button', {
    class: 'btn btn-primary',
    onClick: async () => {
      const t = tokenI.value.trim();
      if (t.length < 8) { st.textContent = '❌ Слишком короткий токен'; return; }
      st.textContent = 'Сохраняю…';
      try {
        await api.setMoyskladToken(t);
        tokenI.value = '';
        st.textContent = '✅ Токен сохранён';
        toast('Токен МойСклад сохранён', 'success');
      } catch (e) {
        st.textContent = `❌ ${e.message}`;
      }
    },
  }, 'Сохранить токен');
  area.append(
    el('div', { class: 'form-row' }, el('label', {}, 'Токен'), tokenI),
    el('div', { class: 'warehouse-toggle-actions' }, saveBtn, st),
  );
}

// Управление способами доставки (для формы заказа). Админ добавляет/удаляет.
// Общая секция управления списком строк (причины отмены и т.п.). Только админ.
async function renderListSettingSection(area, { title, subtitle, load, save, placeholder }) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  area.append(el('div', { class: 'section-header' }, el('h2', {}, title)));
  if (!isAdmin) {
    area.append(el('p', { class: 'muted' }, 'Управлять может только администратор.'));
    return;
  }
  let current = [];
  try {
    current = await load();
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Не удалось загрузить: ${e.message}`));
    return;
  }
  if (subtitle) area.append(el('p', { class: 'page-subtitle' }, subtitle));
  const listEl = el('div', { class: 'marketplace-list' });
  const render = () => {
    clear(listEl);
    current.forEach((m, i) => {
      listEl.append(
        el('div', { class: 'marketplace-row' },
          el('span', {}, m),
          el('button', { class: 'btn btn-sm btn-danger', onClick: () => { current.splice(i, 1); render(); } }, 'Удалить'),
        ),
      );
    });
  };
  render();
  const addInput = el('input', { type: 'text', placeholder: placeholder || 'Новое значение' });
  const addBtn = el('button', {
    class: 'btn',
    onClick: () => {
      const v = addInput.value.trim();
      if (v && !current.includes(v)) { current.push(v); addInput.value = ''; render(); }
    },
  }, 'Добавить');
  const status = el('span', { class: 'save-status' });
  const saveBtn = el('button', {
    class: 'btn btn-primary',
    onClick: async () => {
      status.textContent = 'Сохраняю…';
      try { await save(current); status.textContent = '✅ Сохранено'; toast('Сохранено', 'success'); }
      catch (e) { status.textContent = `❌ ${e.message}`; }
    },
  }, 'Сохранить');
  area.append(
    listEl,
    el('div', { class: 'marketplace-add' }, addInput, addBtn),
    el('div', { class: 'warehouse-toggle-actions' }, saveBtn, status),
  );
}

async function renderDeliveryMethodsSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🚚 Способы доставки')));

  if (!isAdmin) {
    area.append(el('p', { class: 'muted' }, 'Управлять способами доставки может только администратор.'));
    return;
  }

  let current = [];
  try {
    const r = await api.deliveryMethodsList();
    current = r.delivery_methods || [];
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Не удалось загрузить: ${e.message}`));
    return;
  }

  area.append(el('p', { class: 'page-subtitle' }, 'Эти способы доступны в поле «Способ отправки» при создании заказа.'));

  const listEl = el('div', { class: 'marketplace-list' });
  const render = () => {
    clear(listEl);
    current.forEach((m, i) => {
      listEl.append(
        el(
          'div',
          { class: 'marketplace-row' },
          el('span', {}, m),
          el('button', {
            class: 'btn btn-sm btn-danger',
            onClick: () => { current.splice(i, 1); render(); },
          }, 'Удалить'),
        ),
      );
    });
  };
  render();

  const addInput = el('input', { type: 'text', placeholder: 'Название способа доставки' });
  const addBtn = el('button', {
    class: 'btn',
    onClick: () => {
      const v = addInput.value.trim();
      if (v && !current.includes(v)) { current.push(v); addInput.value = ''; render(); }
    },
  }, 'Добавить');
  const status = el('span', { class: 'save-status' });
  const saveBtn = el('button', {
    class: 'btn btn-primary',
    onClick: async () => {
      status.textContent = 'Сохраняю…';
      try {
        await api.setDeliveryMethods(current);
        await loadDeliveryMethods();
        status.textContent = '✅ Сохранено';
        toast('Способы доставки сохранены', 'success');
      } catch (e) {
        status.textContent = `❌ ${e.message}`;
      }
    },
  }, 'Сохранить');

  area.append(
    listEl,
    el('div', { class: 'marketplace-add' }, addInput, addBtn),
    el('div', { class: 'warehouse-toggle-actions' }, saveBtn, status),
  );
}

// Управление списком площадок (маркетплейсов). Админ добавляет/удаляет.
async function renderMarketplacesSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🛒 Площадки продаж')));

  if (!isAdmin) {
    area.append(el('p', { class: 'muted' }, 'Управлять площадками может только администратор.'));
    return;
  }

  let current = [];
  try {
    const r = await api.marketplacesList();
    current = r.marketplaces || [];
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Не удалось загрузить: ${e.message}`));
    return;
  }

  area.append(
    el('p', { class: 'page-subtitle' }, 'Эти площадки доступны в форме заказа, прайсах и фильтрах каталога.'),
  );

  const listEl = el('div', { class: 'marketplace-list' });
  const render = () => {
    clear(listEl);
    current.forEach((m, i) => {
      listEl.append(
        el(
          'div',
          { class: 'marketplace-row' },
          el('span', {}, m),
          el(
            'button',
            {
              class: 'btn btn-sm btn-danger',
              onClick: () => {
                current.splice(i, 1);
                render();
              },
            },
            'Удалить',
          ),
        ),
      );
    });
  };
  render();

  const addInput = el('input', { type: 'text', placeholder: 'Название площадки' });
  const addBtn = el(
    'button',
    {
      class: 'btn',
      onClick: () => {
        const v = addInput.value.trim();
        if (v && !current.includes(v)) {
          current.push(v);
          addInput.value = '';
          render();
        }
      },
    },
    'Добавить',
  );
  const status = el('span', { class: 'save-status' });
  const saveBtn = el(
    'button',
    {
      class: 'btn btn-primary',
      onClick: async () => {
        status.textContent = 'Сохраняю…';
        try {
          await api.setMarketplaces(current);
          await loadMarketplaces();
          status.textContent = '✅ Сохранено';
          toast('Площадки сохранены', 'success');
        } catch (e) {
          status.textContent = `❌ ${e.message}`;
        }
      },
    },
    'Сохранить',
  );

  area.append(
    listEl,
    el('div', { class: 'marketplace-add' }, addInput, addBtn),
    el('div', { class: 'warehouse-toggle-actions' }, saveBtn, status),
  );
}

// Настройка видимости складов: какие склады показывать в каталоге и учитывать в остатке.
async function renderWarehousesSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🏬 Видимость складов')));

  let data;
  try {
    data = await api.warehousesList();
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Не удалось загрузить склады: ${e.message}`));
    return;
  }
  const all = data.all || [];
  if (!all.length) {
    area.append(
      emptyState({
        icon: '🏬',
        title: 'Склады ещё не загружены',
        description: 'Сначала импортируйте остатки по складам из МойСклад (Каталог → 🏬 Склады).',
      }),
    );
    return;
  }

  const hidden = new Set(data.hidden || []);
  area.append(
    el('p', { class: 'page-subtitle' },
      'Снимите галочку, чтобы скрыть склад: он не будет показываться в каталоге, а его остаток не войдёт в «Остаток» товара.'),
  );

  const checkboxes = new Map();
  const list = el('div', { class: 'warehouse-toggle-list' });
  for (const store of all) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !hidden.has(store);
    checkboxes.set(store, cb);
    list.append(el('label', { class: 'warehouse-toggle' }, cb, el('span', {}, store)));
  }
  area.append(list);

  if (isAdmin) {
    const status = el('span', { class: 'save-status' });
    const saveBtn = el(
      'button',
      {
        class: 'btn btn-primary',
        onClick: async () => {
          const newHidden = [...checkboxes.entries()].filter(([, cb]) => !cb.checked).map(([s]) => s);
          status.textContent = 'Сохраняю…';
          try {
            await api.setHiddenWarehouses(newHidden);
            status.textContent = '✅ Сохранено';
            toast('Настройка складов сохранена', 'success');
          } catch (e) {
            status.textContent = `❌ ${e.message}`;
          }
        },
      },
      'Сохранить',
    );
    area.append(el('div', { class: 'warehouse-toggle-actions' }, saveBtn, status));

    // Склад списания по умолчанию — подставляется в форму заказа.
    area.append(el('div', { class: 'section-header', style: { marginTop: '20px' } }, el('h2', {}, '📦 Склад списания по умолчанию')));
    area.append(el('p', { class: 'page-subtitle' },
      'Этот склад будет автоматически выбираться в форме нового заказа (можно изменить вручную).'));
    const defSel = el(
      'select',
      {},
      el('option', { value: '' }, '— не задан —'),
      ...all.map((s) => el('option', { value: s, selected: s === (data.default_writeoff || '') ? true : false }, s)),
    );
    const defStatus = el('span', { class: 'save-status' });
    const defSaveBtn = el('button', {
      class: 'btn btn-primary',
      onClick: async () => {
        defStatus.textContent = 'Сохраняю…';
        try {
          await api.setDefaultWarehouse(defSel.value);
          defStatus.textContent = '✅ Сохранено';
          toast('Склад списания по умолчанию сохранён', 'success');
        } catch (e) {
          defStatus.textContent = `❌ ${e.message}`;
        }
      },
    }, 'Сохранить');
    area.append(el('div', { class: 'form-row' }, el('label', {}, 'Склад'), defSel));
    area.append(el('div', { class: 'warehouse-toggle-actions' }, defSaveBtn, defStatus));

    // Канал по умолчанию — подставляется в форму заказа (нужен для подбора цены канал+склад).
    area.append(el('div', { class: 'section-header', style: { marginTop: '20px' } }, el('h2', {}, '🛒 Канал по умолчанию')));
    area.append(el('p', { class: 'page-subtitle' },
      'Этот канал будет автоматически выбираться в форме нового заказа. Без канала прайс в заказ не подставится (модель «канал + склад»).'));
    const mktSel = el(
      'select',
      {},
      el('option', { value: '' }, '— не задан —'),
      ...MARKETPLACES.filter((m) => m.value).map((m) =>
        el('option', { value: m.value, selected: m.value === (data.default_marketplace || '') ? true : false }, m.label),
      ),
    );
    const mktStatus = el('span', { class: 'save-status' });
    const mktSaveBtn = el('button', {
      class: 'btn btn-primary',
      onClick: async () => {
        mktStatus.textContent = 'Сохраняю…';
        try {
          await api.setDefaultMarketplace(mktSel.value);
          mktStatus.textContent = '✅ Сохранено';
          toast('Канал по умолчанию сохранён', 'success');
        } catch (e) {
          mktStatus.textContent = `❌ ${e.message}`;
        }
      },
    }, 'Сохранить');
    area.append(el('div', { class: 'form-row' }, el('label', {}, 'Канал'), mktSel));
    area.append(el('div', { class: 'warehouse-toggle-actions' }, mktSaveBtn, mktStatus));

    // Способ оплаты по умолчанию — подставляется в форму заказа.
    area.append(el('div', { class: 'section-header', style: { marginTop: '20px' } }, el('h2', {}, '💳 Способ оплаты по умолчанию')));
    area.append(el('p', { class: 'page-subtitle' },
      'Этот способ оплаты будет автоматически выбираться при создании нового заказа. Менеджер может изменить при необходимости.'));
    let pricing = { payment_methods: [] };
    try { pricing = await api.pricingSettings(); } catch { /* ignore */ }
    const payments = pricing.payment_methods || [];
    const paySel = el(
      'select',
      {},
      el('option', { value: '' }, '— не задан —'),
      ...payments.map((m) =>
        el('option', { value: m.key, selected: m.key === (data.default_payment_method || '') ? true : false },
          `${m.label}${m.percent ? ` (${m.percent > 0 ? '+' : ''}${m.percent}%)` : ''}`),
      ),
    );
    const payStatus = el('span', { class: 'save-status' });
    const paySaveBtn = el('button', {
      class: 'btn btn-primary',
      onClick: async () => {
        payStatus.textContent = 'Сохраняю…';
        try {
          await api.setDefaultPaymentMethod(paySel.value);
          payStatus.textContent = '✅ Сохранено';
          toast('Способ оплаты по умолчанию сохранён', 'success');
        } catch (e) {
          payStatus.textContent = `❌ ${e.message}`;
        }
      },
    }, 'Сохранить');
    area.append(el('div', { class: 'form-row' }, el('label', {}, 'Способ оплаты'), paySel));
    area.append(el('div', { class: 'warehouse-toggle-actions' }, paySaveBtn, payStatus));
  } else {
    area.append(el('p', { class: 'muted' }, 'Менять настройку может только администратор.'));
  }
}

async function renderTokensSection(area) {
  clear(area);
  area.append(
    el(
      'div',
      { class: 'section-header' },
      el('h2', {}, 'API-токены'),
      el(
        'button',
        { class: 'btn btn-primary', onClick: () => openCreateToken(() => renderTokensSection(area)) },
        'Новый токен',
      ),
    ),
  );

  try {
    const res = await api.apiTokens();
    const rows = res.data || [];
    if (rows.length === 0) {
      area.append(
        emptyState({
          icon: '🔑',
          title: 'Нет ни одного токена',
          description:
            'Создайте токен и передайте его внешнему сайту, лендингу или Telegram-боту. Каждый клиент получает отдельный токен — так удобнее отзывать доступ.',
        }),
      );
      return;
    }
    const table = el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Название'),
          el('th', {}, 'Префикс'),
          el('th', {}, 'Права'),
          el('th', {}, 'Последний раз'),
          el('th', {}, 'Создан'),
          el('th', {}, 'Статус'),
          el('th', { style: { textAlign: 'right' } }, 'Действия'),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map((r) => {
          const isRevoked = !!r.revoked_at;
          return el(
            'tr',
            {},
            el('td', {}, r.name),
            el('td', {}, el('code', {}, r.token_prefix)),
            el('td', {}, r.scopes),
            el('td', {}, r.last_used_at ? fmtDateTime(r.last_used_at) : 'не использовался'),
            el('td', {}, fmtDate(r.created_at)),
            el(
              'td',
              {},
              el(
                'span',
                { class: 'badge ' + (isRevoked ? 'cancelled' : 'completed') },
                isRevoked ? 'Отозван' : 'Активен',
              ),
            ),
            el(
              'td',
              { style: { textAlign: 'right' } },
              isRevoked
                ? el(
                    'button',
                    {
                      class: 'btn btn-sm',
                      onClick: async () => {
                        if (!(await confirm('Удалить запись о токене безвозвратно?'))) return;
                        await api.deleteApiToken(r.id);
                        renderTokensSection(area);
                      },
                    },
                    'Удалить',
                  )
                : el(
                    'button',
                    {
                      class: 'btn btn-sm btn-danger',
                      onClick: async () => {
                        if (!(await confirm(`Отозвать токен «${r.name}»? Внешний сервис перестанет работать.`))) return;
                        await api.revokeApiToken(r.id);
                        toast('Токен отозван', 'success');
                        renderTokensSection(area);
                      },
                    },
                    'Отозвать',
                  ),
            ),
          );
        }),
      ),
    );
    area.append(el('div', { class: 'table-wrap' }, table));
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
  }
}

async function openCreateToken(onCreated) {
  const nameInput = el('input', { type: 'text', placeholder: 'Например: Лендинг example.com' });
  const scopeLeads = el('input', { type: 'checkbox', checked: true });
  const scopeOrders = el('input', { type: 'checkbox', checked: true });

  const body = el(
    'div',
    {},
    el('div', { class: 'form-row' }, el('label', {}, 'Название *'), nameInput),
    el(
      'div',
      { class: 'form-row' },
      el('label', {}, 'Разрешённые действия'),
      el(
        'div',
        {},
        el('label', { style: { display: 'block' } }, scopeLeads, ' Создавать лидов (leads:create)'),
        el('label', { style: { display: 'block' } }, scopeOrders, ' Создавать заказы (orders:create)'),
      ),
    ),
    el(
      'div',
      { class: 'hint' },
      'После создания токен будет показан ОДИН раз — скопируйте его сразу.',
    ),
  );

  await openModal('Новый API-токен', body, {
    primaryLabel: 'Создать',
    onSubmit: async () => {
      if (!nameInput.value.trim()) {
        toast('Укажите название', 'error');
        return false;
      }
      const scopes = [
        scopeLeads.checked && 'leads:create',
        scopeOrders.checked && 'orders:create',
      ].filter(Boolean).join(',') || 'leads:create';
      const r = await api.createApiToken({ name: nameInput.value.trim(), scopes });
      onCreated?.();
      await showTokenOnce(r.token);
    },
  });
}

async function showTokenOnce(token) {
  const tokenBox = el(
    'div',
    { class: 'token-display' },
    el('code', {}, token),
  );
  const copyBtn = el(
    'button',
    {
      class: 'btn btn-primary',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(token);
          toast('Скопировано', 'success');
        } catch {
          prompt('Скопируйте вручную:', token);
        }
      },
    },
    'Скопировать',
  );
  await openModal(
    'Токен создан — сохраните его сейчас',
    el(
      'div',
      {},
      el('p', {}, 'Это значение больше нигде не будет показано. Скопируйте и сохраните в безопасном месте.'),
      tokenBox,
      copyBtn,
      el(
        'div',
        { class: 'hint', style: { marginTop: '12px' } },
        'Передавайте этот токен внешним сервисам в заголовке X-API-Token при запросах к /api/external/*.',
      ),
    ),
    {},
  );
}

async function renderWebhooksSection(area) {
  clear(area);
  area.append(
    el(
      'div',
      { class: 'section-header' },
      el('h2', {}, 'Исходящие вебхуки'),
      el(
        'button',
        { class: 'btn btn-primary', onClick: () => openCreateWebhook(() => renderWebhooksSection(area)) },
        'Новый webhook',
      ),
    ),
  );

  try {
    const res = await api.webhooks();
    const rows = res.data || [];
    if (rows.length === 0) {
      area.append(
        emptyState({
          icon: '📡',
          title: 'Вебхуков нет',
          description:
            'Webhook позволяет уведомлять ваши внешние системы об изменениях в CRM. Например, бухгалтерия узнаёт о завершённом заказе, склад — о новом резерве.',
        }),
      );
      return;
    }
    const table = el(
      'table',
      { class: 'data' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Название'),
          el('th', {}, 'URL'),
          el('th', {}, 'События'),
          el('th', {}, 'Доставок'),
          el('th', {}, 'Последняя'),
          el('th', {}, 'Статус'),
          el('th', { style: { textAlign: 'right' } }, 'Действия'),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map((w) =>
          el(
            'tr',
            {},
            el('td', {}, w.name),
            el('td', {}, el('code', { style: { fontSize: '11px' } }, w.url)),
            el('td', {}, w.events),
            el('td', {}, w.deliveries_count || 0),
            el(
              'td',
              {},
              w.last_delivery_at
                ? `${fmtDateTime(w.last_delivery_at)} (${w.last_status_code || 'err'})`
                : '—',
            ),
            el(
              'td',
              {},
              el(
                'span',
                { class: 'badge ' + (w.active ? 'completed' : 'cancelled') },
                w.active ? 'Вкл' : 'Выкл',
              ),
            ),
            el(
              'td',
              { style: { textAlign: 'right' } },
              el(
                'button',
                {
                  class: 'btn btn-sm',
                  onClick: async () => {
                    await api.updateWebhook(w.id, { active: !w.active });
                    renderWebhooksSection(area);
                  },
                },
                w.active ? 'Выкл' : 'Вкл',
              ),
              el(
                'button',
                {
                  class: 'btn btn-sm btn-danger',
                  onClick: async () => {
                    if (!(await confirm(`Удалить webhook «${w.name}»?`))) return;
                    await api.deleteWebhook(w.id);
                    renderWebhooksSection(area);
                  },
                },
                'Удалить',
              ),
            ),
          ),
        ),
      ),
    );
    area.append(el('div', { class: 'table-wrap' }, table));
  } catch (e) {
    area.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
  }
}

async function openCreateWebhook(onCreated) {
  const nameI = el('input', { type: 'text', placeholder: 'Например: Уведомления склада' });
  const urlI = el('input', { type: 'url', placeholder: 'https://...' });
  const eventsI = el(
    'select',
    {},
    el('option', { value: '*' }, 'Все события (*)'),
    el('option', { value: 'lead.created' }, 'lead.created'),
    el('option', { value: 'order.created' }, 'order.created'),
    el('option', { value: 'order.created,order.reserved' }, 'order.created + order.reserved'),
    el(
      'option',
      { value: 'order.created,order.reserved,order.shipped,order.completed,order.cancelled' },
      'Все события заказа',
    ),
    el(
      'option',
      { value: 'payment.confirmed,payment.rejected' },
      'Платежи (подтверждение/отклонение)',
    ),
  );
  const secretI = el('input', { type: 'text', placeholder: 'Опционально: для подписи HMAC' });

  const body = el(
    'div',
    {},
    el('div', { class: 'form-row' }, el('label', {}, 'Название *'), nameI),
    el('div', { class: 'form-row' }, el('label', {}, 'URL *'), urlI),
    el('div', { class: 'form-row' }, el('label', {}, 'События'), eventsI),
    el('div', { class: 'form-row' }, el('label', {}, 'Секрет для HMAC'), secretI),
    el(
      'div',
      { class: 'hint' },
      'Мы пошлём POST с JSON {event, payload, ts}. Если указан секрет, добавим заголовок X-CRM-Signature: sha256=…',
    ),
  );

  await openModal('Новый webhook', body, {
    primaryLabel: 'Создать',
    onSubmit: async () => {
      if (!nameI.value.trim() || !urlI.value.trim()) {
        toast('Заполните название и URL', 'error');
        return false;
      }
      await api.createWebhook({
        name: nameI.value.trim(),
        url: urlI.value.trim(),
        events: eventsI.value,
        secret: secretI.value.trim() || null,
      });
      toast('Webhook добавлен', 'success');
      onCreated?.();
    },
  });
}

function renderDocsSection(area) {
  clear(area);
  area.append(
    el('h2', { style: { marginTop: '24px' } }, 'Как подключить'),
    el(
      'div',
      { class: 'docs-grid' },
      el(
        'div',
        { class: 'card' },
        el('h3', {}, '🌐 Свой лендинг / сайт'),
        el('p', {}, 'Самый простой способ — добавить одну строку в HTML:'),
        el(
          'pre',
          { class: 'code-block' },
          `<script src="${location.origin}/embed/form.js"\n        data-token="ВАШ_ТОКЕН"\n        data-marketplace="Сайт example.com"></script>`,
        ),
        el(
          'p',
          {},
          'На странице появится готовая форма заявки. Заявка прилетит в раздел «Лиды» и менеджер получит уведомление.',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, '📥 Прямой вызов API'),
        el('p', {}, 'Для собственной интеграции присылайте POST:'),
        el(
          'pre',
          { class: 'code-block' },
          `POST ${location.origin}/api/external/leads
X-API-Token: ВАШ_ТОКЕН
Content-Type: application/json

{
  "first_name": "Иван",
  "phone": "+7...",
  "email": "ivan@example.com",
  "source": "website",
  "description": "Хочет каталог"
}`,
        ),
        el(
          'p',
          {},
          'Для заказов — тот же подход на /api/external/orders с массивом items.',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, '🤖 Telegram-бот'),
        el(
          'p',
          {},
          'В репозитории — examples/telegram-bot.js. Бот спрашивает у пользователя имя/телефон и шлёт лида через тот же /api/external/leads. Запускается как отдельный процесс с TELEGRAM_TOKEN и CRM_API_TOKEN в окружении.',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h3', {}, '📡 Webhook на ваши системы'),
        el(
          'p',
          {},
          'Когда заказ меняет статус, мы шлём вашему серверу JSON. Удобно для бухгалтерии, складского ПО, аналитики. Подписать запрос можно HMAC-секретом.',
        ),
      ),
    ),
  );
}

// ============================================================
// Глобальный поиск (Ctrl+K)
// ============================================================

let searchModalOpen = false;

export function openGlobalSearch() {
  if (searchModalOpen) return;
  searchModalOpen = true;
  const root = document.getElementById('modal-root');
  const input = el('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Поиск по контактам, компаниям, лидам, сделкам, заказам…',
    autofocus: true,
  });
  const results = el('div', { class: 'search-results' });

  const close = () => {
    searchModalOpen = false;
    backdrop.remove();
    document.removeEventListener('keydown', escListener);
  };
  const escListener = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', escListener);

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 2) {
      clear(results);
      results.append(el('div', { class: 'search-hint' }, 'Введите минимум 2 символа…'));
      return;
    }
    debounce = setTimeout(async () => {
      try {
        const r = await api.search(q);
        renderResults(r);
      } catch (e) {
        clear(results);
        results.append(el('div', { class: 'search-hint' }, e.message));
      }
    }, 200);
  });

  function renderResults(r) {
    clear(results);
    const groups = [
      ['leads', '🌱 Лиды', '#/leads', (x) => `${x.first_name} ${x.last_name || ''} — ${x.email || x.phone || ''}`],
      ['contacts', '👥 Контакты', '#/contacts', (x) => `${x.first_name} ${x.last_name || ''} — ${x.email || x.phone || ''}`],
      ['companies', '🏢 Компании', '#/companies', (x) => x.name],
      ['deals', '💼 Сделки', '#/deals', (x) => `${x.title} — ${fmtMoney(x.amount, x.currency)}`],
      ['orders', '📦 Заказы', '#/orders', (x) => `#${x.id} ${x.client_name || ''} — ${fmtMoney(x.total_amount, x.currency)}`],
    ];
    let total = 0;
    for (const [key, label, href, fmt] of groups) {
      const items = r[key] || [];
      if (!items.length) continue;
      total += items.length;
      results.append(
        el('div', { class: 'search-group-label' }, label),
        ...items.map((it) =>
          el(
            'a',
            {
              class: 'search-row',
              href,
              onClick: close,
            },
            fmt(it),
          ),
        ),
      );
    }
    if (total === 0) {
      results.append(el('div', { class: 'search-hint' }, 'Ничего не найдено'));
    }
  }

  const modal = el(
    'div',
    { class: 'search-modal' },
    input,
    el(
      'div',
      { class: 'search-hint search-help' },
      'Esc — закрыть · стрелка вверх/вниз — навигация · Enter — открыть',
    ),
    results,
  );
  const backdrop = el(
    'div',
    {
      class: 'modal-backdrop',
      onClick: (e) => {
        if (e.target === backdrop) close();
      },
    },
    modal,
  );
  root.append(backdrop);
  setTimeout(() => input.focus(), 0);
  clear(results);
  results.append(el('div', { class: 'search-hint' }, 'Введите минимум 2 символа…'));
}

// ============================================================
// Каталог товаров: себестоимость, картинки, прайсы по площадкам
// ============================================================

// Из stock_by_store выбираем видимые склады (не скрытые) с остатком или резервом > 0.
// Возвращаем строки для показа + суммы доступного остатка и резерва.
function computeStoreView(stockByStore, hiddenSet) {
  if (!Array.isArray(stockByStore)) return { visible: [], totalStock: 0, totalReserve: 0 };
  let totalStock = 0;
  let totalReserve = 0;
  const visible = [];
  for (const s of stockByStore) {
    if (hiddenSet.has(s.store)) continue;
    const stock = Number(s.stock) || 0;
    const reserve = Number(s.reserve) || 0;
    totalStock += stock;
    totalReserve += reserve;
    if (stock !== 0 || reserve !== 0) visible.push({ store: s.store, stock, reserve });
  }
  return { visible, totalStock, totalReserve };
}

export async function renderProducts(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit = me.role === 'admin';
  const isAdmin = me.role === 'admin';

  // Скрытые склады (настройка) — загружаем один раз, применяем при отображении остатков.
  let hiddenSet = new Set();
  let visibleWarehouses = [];
  let suppliers = [];
  try {
    const w = await api.warehousesList();
    hiddenSet = new Set(w.hidden || []);
    visibleWarehouses = (w.all || []).filter((s) => !hiddenSet.has(s));
  } catch {
    // нет настройки — показываем все склады
  }
  try {
    const s = await api.suppliersList();
    suppliers = s.suppliers || [];
  } catch {
    // нет поставщиков
  }

  // Если в URL #/products?markdown=1 — фильтр уценённых без цены.
  const hashQs = new URLSearchParams((location.hash.split('?')[1] || ''));
  const markdownFilter = hashQs.get('markdown') === '1';
  let state = { page: 1, search: '', stock: '', warehouse: '', supplier: '', priced: '', markdown: markdownFilter ? '1' : '' };
  let view = localStorage.getItem('products_view') === 'list' ? 'list' : 'grid';
  let lastResult = null;
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.list('products', { ...state, limit: 50 });
      renderTable(r);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function renderTable(result) {
    lastResult = result;
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      tableArea.append(
        emptyState({
          icon: '📦',
          title: state.search ? 'Ничего не найдено' : 'Каталог пуст',
          description: state.search
            ? `По запросу «${state.search}» ничего нет.`
            : 'Добавьте первый товар вручную или нажмите «Импорт из МойСклад», чтобы синхронизировать каталог из учётной системы. Себестоимость и картинки подтянутся автоматически.',
        }),
      );
      return;
    }
    const grid = el('div', { class: 'product-grid' });
    for (const p of rows) {
      grid.append(
        el(
          'div',
          {
            class: 'product-card',
            onClick: () => canEdit && openProductForm(p, reload),
          },
          el(
            'div',
            { class: 'product-card-image' },
            p.image_url
              ? el('img', { src: p.image_url, alt: '' })
              : el('div', { class: 'product-card-image-empty' }, '📦'),
          ),
          el('div', { class: 'product-card-name' }, p.name),
          el(
            'div',
            { class: 'product-card-sku' },
            p.sku ? `Арт: ${p.sku}` : 'Без артикула',
            p.external_source ? el('span', { class: 'badge ms-badge' }, p.external_source) : null,
          ),
          el(
            'div',
            { class: 'product-card-prices' },
            el(
              'div',
              { class: 'product-card-cost' },
              el('span', {}, 'Себестоимость '),
              el('strong', {}, fmtMoney(p.cost_price, 'RUB')),
            ),
            Array.isArray(p.prices) && p.prices.length
              ? el(
                  'div',
                  { class: 'product-card-pricelists' },
                  ...p.prices.map((pr) =>
                    el('div', { class: 'price-channel' }, `${pr.marketplace}${pr.warehouse ? ' · ' + pr.warehouse : ''}: ${fmtMoney(pr.price, 'RUB')}`),
                  ),
                )
              : el('div', { class: 'product-card-pricelists' }, el('span', { class: 'no-prices' }, 'нет прайсов')),
          ),
          (() => {
            const sv = computeStoreView(p.stock_by_store, hiddenSet);
            const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
            const stockVal = hasStores ? sv.totalStock : p.stock;
            return el(
              'div',
              { class: 'product-card-stock' },
              'Остаток: ',
              el('strong', {}, stockVal != null ? String(stockVal) : '—'),
              sv.totalReserve > 0
                ? el('span', { class: 'product-card-reserve' }, ` (резерв: ${sv.totalReserve})`)
                : null,
            );
          })(),
          (() => {
            const sv = computeStoreView(p.stock_by_store, hiddenSet);
            return sv.visible.length
              ? el(
                  'div',
                  { class: 'product-card-stores' },
                  sv.visible
                    .map((s) => (s.reserve > 0 ? `${s.store}: ${s.stock} (рез. ${s.reserve})` : `${s.store}: ${s.stock}`))
                    .join(', '),
                )
              : null;
          })(),
          !p.active ? el('div', { class: 'product-inactive-badge' }, 'Архив') : null,
        ),
      );
    }
    tableArea.append(view === 'list' ? renderProductsList(rows) : grid);
    tableArea.append(
      paginator(result.pagination, (p) => {
        state.page = p;
        reload();
      }),
    );
  }

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Поиск по названию или артикулу…',
    onInput: (e) => {
      clearTimeout(searchInput._t);
      searchInput._t = setTimeout(() => {
        state.search = e.target.value;
        state.page = 1;
        reload();
      }, 250);
    },
  });

  function renderProductsList(rows) {
    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { style: { width: '44px' } }, ''),
            el('th', {}, 'Название'),
            el('th', {}, 'Артикул'),
            el('th', {}, 'Себестоимость'),
            el('th', {}, 'Остаток'),
            el('th', {}, 'Склады'),
            el('th', {}, 'Канал — цена'),
            el('th', {}, 'Статус'),
          ),
        ),
        el(
          'tbody',
          {},
          ...rows.map((p) =>
            el(
              'tr',
              {
                class: canEdit ? 'row-clickable' : '',
                onClick: () => canEdit && openProductForm(p, reload),
              },
              el(
                'td',
                {},
                p.image_url
                  ? el('img', { src: p.image_url, class: 'item-thumb', alt: '' })
                  : el('div', { class: 'item-thumb item-thumb-empty' }, '📦'),
              ),
              el(
                'td',
                {},
                el('strong', {}, p.name),
                p.external_source ? el('span', { class: 'badge ms-badge' }, p.external_source) : null,
              ),
              el('td', {}, p.sku ? el('code', {}, p.sku) : '—'),
              el('td', {}, fmtMoney(p.cost_price, 'RUB')),
              (() => {
                const sv = computeStoreView(p.stock_by_store, hiddenSet);
                const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
                const stockVal = hasStores ? sv.totalStock : p.stock;
                return el(
                  'td',
                  {},
                  stockVal != null ? String(stockVal) : '—',
                  sv.totalReserve > 0 ? el('span', { class: 'muted' }, ` (рез. ${sv.totalReserve})`) : null,
                );
              })(),
              (() => {
                const sv = computeStoreView(p.stock_by_store, hiddenSet);
                return el(
                  'td',
                  { class: 'stores-cell' },
                  sv.visible.length
                    ? sv.visible
                        .map((s) => (s.reserve > 0 ? `${s.store}: ${s.stock} (рез. ${s.reserve})` : `${s.store}: ${s.stock}`))
                        .join(', ')
                    : '—',
                );
              })(),
              el(
                'td',
                { class: 'prices-cell' },
                Array.isArray(p.prices) && p.prices.length
                  ? p.prices.map((pr) => `${pr.marketplace}${pr.warehouse ? ' · ' + pr.warehouse : ''}: ${fmtMoney(pr.price, 'RUB')}`).join(', ')
                  : el('span', { class: 'no-prices' }, 'нет'),
              ),
              el('td', {}, p.active ? 'Активен' : el('span', { class: 'muted' }, 'Архив')),
            ),
          ),
        ),
      ),
    );
  }

  const gridBtn = el('button', { class: `btn btn-view${view === 'grid' ? ' active' : ''}`, title: 'Плитки', onClick: () => setView('grid') }, '▦');
  const listBtn = el('button', { class: `btn btn-view${view === 'list' ? ' active' : ''}`, title: 'Список', onClick: () => setView('list') }, '☰');
  function setView(v) {
    if (view === v) return;
    view = v;
    localStorage.setItem('products_view', v);
    gridBtn.classList.toggle('active', v === 'grid');
    listBtn.classList.toggle('active', v === 'list');
    if (lastResult) renderTable(lastResult);
  }

  const stockFilter = el(
    'select',
    {
      class: 'select',
      onChange: (e) => {
        state.stock = e.target.value;
        state.page = 1;
        reload();
      },
    },
    el('option', { value: '' }, 'Все остатки'),
    el('option', { value: 'in' }, 'В наличии'),
    el('option', { value: 'out' }, 'Нет в наличии'),
  );

  const warehouseFilter = visibleWarehouses.length
    ? el(
        'select',
        {
          class: 'select',
          onChange: (e) => {
            state.warehouse = e.target.value;
            state.page = 1;
            reload();
          },
        },
        el('option', { value: '' }, 'Все склады'),
        ...visibleWarehouses.map((w) => el('option', { value: w }, w)),
      )
    : null;

  const supplierFilter = suppliers.length
    ? el(
        'select',
        {
          class: 'select',
          onChange: (e) => {
            state.supplier = e.target.value;
            state.page = 1;
            reload();
          },
        },
        el('option', { value: '' }, 'Все поставщики'),
        ...suppliers.map((s) => el('option', { value: s }, s)),
      )
    : null;

  const pricedFilter = el(
    'select',
    {
      class: 'select',
      onChange: (e) => {
        state.priced = e.target.value;
        state.page = 1;
        reload();
      },
    },
    el('option', { value: '' }, 'Прайс: все'),
    el('option', { value: 'with' }, 'С прайсом'),
    el('option', { value: 'without' }, 'Без прайса'),
  );

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    searchInput,
    stockFilter,
    warehouseFilter,
    supplierFilter,
    pricedFilter,
    el('div', { class: 'view-toggle' }, gridBtn, listBtn),
    el('div', { class: 'spacer' }),
    isAdmin
      ? el(
          'button',
          {
            class: 'btn',
            onClick: () => openMoyskladStores(() => {
              state.page = 1;
              return reload();
            }),
          },
          '🏬 Склады',
        )
      : null,
    isAdmin
      ? el(
          'button',
          {
            class: 'btn',
            onClick: () => openMoyskladStock(() => {
              state.page = 1;
              return reload();
            }),
          },
          '🔄 Остатки',
        )
      : null,
    isAdmin
      ? el(
          'button',
          {
            class: 'btn',
            onClick: () => openMoyskladImport(() => {
              state.page = 1;
              return reload();
            }),
          },
          '⬇ Импорт из МойСклад',
        )
      : null,
    isAdmin
      ? el('button', { class: 'btn', onClick: () => openPriceTemplate() }, '📥 Шаблон прайса')
      : null,
    isAdmin
      ? el(
          'button',
          {
            class: 'btn',
            onClick: () => openPriceUpload(() => {
              state.page = 1;
              return reload();
            }),
          },
          '📤 Загрузить прайс',
        )
      : null,
    isAdmin
      ? el('button', { class: 'btn', onClick: () => openPricingSettings() }, '⚙ Правила цен')
      : null,
    isAdmin
      ? el('button', { class: 'btn', onClick: () => openPriceAckStatus() }, '👥 Ознакомление с прайсом')
      : null,
    isAdmin
      ? el('button', { class: 'btn', onClick: () => openImportNamesModal(reload) }, '✏️ Обновить названия')
      : null,
    isAdmin
      ? el('button', {
          class: 'btn',
          onClick: async () => {
            if (!(await confirm('Удалить все прайсы без склада (старые, до привязки к складу)? Цены с указанным складом останутся.'))) return;
            try {
              const r = await api.purgeLegacyPrices();
              toast(`Удалено прайсов без склада: ${r.deleted}`, 'success');
              state.page = 1;
              reload();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, '🧹 Очистить прайсы без склада')
      : null,
    canEdit
      ? el(
          'button',
          {
            class: 'btn btn-primary',
            onClick: () => openProductForm(null, reload),
          },
          'Новый товар',
        )
      : null,
  );

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el(
        'div',
        {},
        el('h1', { class: 'page-title' }, 'Каталог товаров'),
        el(
          'div',
          { class: 'page-subtitle' },
          'Себестоимость, картинки и прайсы по площадкам. Используется в форме заказа.',
        ),
      ),
    ),
    el('div', { class: 'help-row' }, helpButton('products')),
    // null нельзя — main.append(null) рендерит 'null' как текст. Используем
    // пустой фрагмент.
    markdownFilter
      ? el('div', { class: 'help-banner', style: { background: '#fef3c7', borderColor: '#fde68a', color: '#92400e' } },
          '🏷️ Показаны уценённые товары. Проставьте цену в карточке (раздел «Прайсы»). ',
          el('a', { href: '#/products', style: { color: 'var(--primary)' } }, 'Снять фильтр'))
      : document.createDocumentFragment(),
    toolbar,
    tableArea,
  );
  reload();
}

async function openProductForm(product, onSaved) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  const isEdit = !!product;
  const cur = product || {};
  if (isEdit && !cur.prices) {
    // Подгрузим прайсы
    try {
      const full = await api.get('products', cur.id);
      Object.assign(cur, full);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
  }
  // Список складов для прайса (цена задаётся на канал + склад) и для
  // фильтра блока «Остатки по складам» ниже — чтобы не показывать чужие
  // фулфилменты (FBW Иваненко/Уютный мир, Qazpost и т.п.), которые скрыты
  // в Настройках → Видимость складов.
  let priceWarehouses = [];
  let hiddenStoresSet = new Set();
  try {
    const w = await api.warehousesList();
    hiddenStoresSet = new Set(w.hidden || []);
    priceWarehouses = (w.all || []).filter((s) => !hiddenStoresSet.has(s));
  } catch {
    /* складов нет — можно сохранить прайс без склада */
  }

  const nameI = el('input', { type: 'text', value: cur.name || '' });
  const skuI = el('input', { type: 'text', value: cur.sku || '' });
  const imageI = el('input', { type: 'url', value: cur.image_url || '', placeholder: 'https://...' });
  const costI = el('input', { type: 'number', min: '0', step: 'any', value: cur.cost_price ?? 0 });
  const unitI = el('input', { type: 'text', value: cur.unit || 'шт', style: { width: '80px' } });
  const descI = el('textarea', {}, cur.description || '');
  const activeI = el('input', { type: 'checkbox', checked: cur.active !== false });

  const imagePreview = el('div', { class: 'image-preview' });
  function updatePreview() {
    clear(imagePreview);
    if (imageI.value.trim()) {
      imagePreview.append(
        el('img', {
          src: imageI.value.trim(),
          alt: '',
          onError: () => {
            imagePreview.innerHTML = '<div class="image-preview-empty">⚠️ не загрузилась</div>';
          },
        }),
      );
    } else {
      imagePreview.append(el('div', { class: 'image-preview-empty' }, '📦'));
    }
  }
  imageI.addEventListener('input', updatePreview);
  updatePreview();

  // Прайсы по площадкам (только для существующих товаров)
  const pricesArea = el('div', { class: 'prices-editor' });
  function renderPricesEditor() {
    clear(pricesArea);
    const prices = cur.prices || [];
    if (prices.length === 0) {
      pricesArea.append(
        el('div', { class: 'hint' }, 'Прайсов пока нет. Добавьте цену для конкретной площадки ниже.'),
      );
    } else {
      const list = el('div', { class: 'prices-list' });
      for (const pp of prices) {
        const wh = pp.warehouse || '';
        // Цену редактируем инлайн: input с предзаполненным значением.
        // Сохраняем по blur или Enter, если значение изменилось (api.setProductPrice
        // делает INSERT ... ON CONFLICT DO UPDATE → апдейтит существующий ряд).
        const priceInput = el('input', {
          type: 'number',
          min: '0',
          step: 'any',
          value: String(pp.price),
          class: 'price-value-input',
        });
        let savedValue = pp.price;
        async function savePrice() {
          const v = Number(priceInput.value);
          if (!Number.isFinite(v) || v <= 0) {
            priceInput.value = String(savedValue);
            toast('Цена должна быть положительным числом', 'error');
            return;
          }
          if (v === savedValue) return; // ничего не изменилось
          priceInput.disabled = true;
          try {
            await api.setProductPrice(cur.id, { marketplace: pp.marketplace, warehouse: wh, price: v });
            savedValue = v;
            pp.price = v;
            toast(`Цена обновлена: ${v.toLocaleString('ru-RU')} ₽`, 'success');
          } catch (e) {
            priceInput.value = String(savedValue);
            toast(e.message || 'Не удалось сохранить', 'error');
          } finally {
            priceInput.disabled = false;
          }
        }
        priceInput.addEventListener('blur', savePrice);
        priceInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); priceInput.blur(); }
          if (e.key === 'Escape') { priceInput.value = String(savedValue); priceInput.blur(); }
        });
        list.append(
          el(
            'div',
            { class: 'price-row' },
            el('span', { class: 'price-marketplace' }, pp.marketplace + (wh ? ` · ${wh}` : ' · (все склады)')),
            el('div', { class: 'price-value-wrap' }, priceInput, el('span', { class: 'price-currency' }, '₽')),
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn-sm',
                onClick: async () => {
                  if (!(await confirm(`Удалить цену «${pp.marketplace}${wh ? ' · ' + wh : ''}»?`))) return;
                  await api.deleteProductPrice(cur.id, pp.marketplace, wh);
                  cur.prices = cur.prices.filter((x) => !(x.marketplace === pp.marketplace && (x.warehouse || '') === wh));
                  renderPricesEditor();
                },
              },
              'Удалить',
            ),
          ),
        );
      }
      pricesArea.append(list);
    }

    // Форма добавления цены. Раньше тут была площадка (Avito/Wildberries/...) —
    // теперь единый ключ «Общий прайс»: одна цена работает и для маркетплейсов,
    // и для B2B-заказов. Старые marketplace-значения (если ещё есть) показываем
    // в списке выше как есть, но новые добавляются только под «Общий прайс».
    const newMarketI = el(
      'select',
      {},
      el('option', { value: 'Общий прайс', selected: true }, 'Общий прайс'),
    );
    const newWarehouseI = el(
      'select',
      {},
      el('option', { value: '' }, 'Склад…'),
      ...priceWarehouses.map((s) => el('option', { value: s }, s)),
    );
    const newPriceI = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'Цена' });
    pricesArea.append(
      el(
        'div',
        { class: 'price-add-row' },
        newMarketI,
        newWarehouseI,
        newPriceI,
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm btn-primary',
            onClick: async () => {
              if (!newMarketI.value || !newPriceI.value) {
                toast('Выберите площадку и укажите цену', 'error');
                return;
              }
              if (!newWarehouseI.value) {
                toast(priceWarehouses.length ? 'Выберите склад' : 'Сначала импортируйте склады (Каталог → 🏬 Склады)', 'error');
                return;
              }
              await api.setProductPrice(cur.id, {
                marketplace: newMarketI.value,
                warehouse: newWarehouseI.value,
                price: Number(newPriceI.value),
              });
              const updated = await api.get('products', cur.id);
              cur.prices = updated.prices;
              renderPricesEditor();
              toast('Цена сохранена', 'success');
            },
          },
          '+ Добавить',
        ),
      ),
    );
  }

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'form-grid' },
      el(
        'div',
        { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'Название *'),
        nameI,
      ),
      el('div', { class: 'form-row' }, el('label', {}, 'Артикул (SKU)'), skuI),
      el('div', { class: 'form-row' }, el('label', {}, 'Единица'), unitI),
      el(
        'div',
        { class: 'form-row' },
        el('label', {}, 'Себестоимость'),
        costI,
        el('div', { class: 'hint' }, 'Внутренняя цена, не для клиентов'),
      ),
      el(
        'div',
        { class: 'form-row' },
        el('label', {}, 'Активен'),
        el('div', {}, activeI, ' ', el('span', { class: 'hint' }, 'Показывать в пикере заказов')),
      ),
      el(
        'div',
        { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'URL картинки'),
        imageI,
        imagePreview,
      ),
      el(
        'div',
        { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'Описание'),
        descI,
      ),
    ),
    isEdit && Array.isArray(cur.stock_by_store) && cur.stock_by_store.length
      ? (() => {
          // Скрываем чужие склады из «Видимость складов» — менеджеру они только
          // мешают (FBW Иваненко, Qazpost Астана и т.п.). При нулях/отрицаниях
          // тоже скрываем (как раньше).
          const visible = cur.stock_by_store.filter((s) =>
            !hiddenStoresSet.has(s.store)
            && ((Number(s.stock) || 0) !== 0 || (Number(s.reserve) || 0) !== 0));
          const totalStock = visible.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
          const totalReserve = visible.reduce((sum, s) => sum + (Number(s.reserve) || 0), 0);
          return el(
            'div',
            { class: 'form-row', style: { gridColumn: '1 / -1', marginTop: '16px' } },
            el('label', {}, `Остатки по складам (всего: ${totalStock}${totalReserve > 0 ? `, резерв: ${totalReserve}` : ''})`),
            visible.length
              ? el(
                  'div',
                  { class: 'product-stores-table' },
                  ...visible.map((s) =>
                    el(
                      'div',
                      { class: 'product-store-row' },
                      el('span', { class: 'store-name' }, s.store),
                      el('span', { class: 'store-stock' }, `${Number(s.stock) || 0} шт`),
                      (Number(s.reserve) || 0) > 0
                        ? el('span', { class: 'store-reserve' }, `резерв: ${Number(s.reserve)}`)
                        : null,
                    ),
                  ),
                )
              : el('div', { class: 'hint' }, 'Нет остатков ни на одном складе.'),
          );
        })()
      : null,
    isEdit
      ? el(
          'div',
          { class: 'form-row', style: { marginTop: '20px' } },
          el('label', {}, 'Прайсы по площадкам'),
          isAdmin
            ? pricesArea
            : (() => {
                const prices = cur.prices || [];
                if (!prices.length) return el('div', { class: 'hint' }, 'Прайсы не установлены');
                return el(
                  'div',
                  { class: 'prices-list' },
                  ...prices.map((pp) =>
                    el(
                      'div',
                      { class: 'price-row' },
                      el('span', { class: 'price-marketplace' }, pp.marketplace + (pp.warehouse ? ` · ${pp.warehouse}` : '')),
                      el('span', { class: 'price-value' }, `${pp.price.toLocaleString('ru-RU')} ₽`),
                    ),
                  ),
                );
              })(),
        )
      : el(
          'div',
          { class: 'hint', style: { marginTop: '12px' } },
          'Прайсы по площадкам можно будет добавить после сохранения товара.',
        ),
  );

  if (isEdit && isAdmin) renderPricesEditor();

  await openModal(isEdit ? `Товар: ${cur.name}` : 'Новый товар', body, {
    primaryLabel: isEdit ? 'Сохранить' : 'Создать',
    size: 'lg',
    onSubmit: async () => {
      if (!nameI.value.trim()) {
        toast('Укажите название', 'error');
        return false;
      }
      const payload = {
        name: nameI.value.trim(),
        sku: skuI.value.trim() || null,
        image_url: imageI.value.trim() || null,
        cost_price: Number(costI.value) || 0,
        unit: unitI.value.trim() || 'шт',
        description: descI.value.trim() || null,
        active: activeI.checked,
      };
      if (isEdit) await api.update('products', cur.id, payload);
      else await api.create('products', payload);
      toast(isEdit ? 'Сохранено' : 'Товар создан', 'success');
      onSaved?.();
    },
  });
}

async function openMoyskladImport(onDone) {
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен или оставьте пустым, если задан MOYSKLAD_TOKEN' });
  const statusEl = el('div', { class: 'import-status' });

  const body = el(
    'div',
    {},
    el(
      'p',
      {},
      'Импорт подтянет каталог из МойСклад: товары + модификации (размеры/цвета), название, артикул, себестоимость, картинку. Существующие обновятся (linked by external_id). Сделать это безопасно несколько раз. Большой каталог может занять до минуты.',
    ),
    el(
      'p',
      {},
      'Где взять токен: ',
      el(
        'a',
        { href: 'https://dev.moysklad.ru/doc/api/remap/1.2/#mojsklad-json-api-obschie-svedeniq-autentifikaciq', target: '_blank' },
        'документация МойСклад',
      ),
      ' (Настройки → Доступ → API).',
    ),
    el('div', { class: 'form-row' }, el('label', {}, 'Токен'), tokenI),
    statusEl,
  );

  await openModal('Импорт из МойСклад', body, {
    primaryLabel: 'Начать импорт',
    onSubmit: async () => {
      statusEl.textContent = '⏳ Импортируем, это может занять до минуты…';
      try {
        const r = await api.importMoysklad(tokenI.value.trim() || undefined);
        // Данные из МойСклад (название/артикул поставщика) экранируем — это внешний источник.
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const parts = [`создано ${r.created}`, `обновлено ${r.updated}`, `всего получено из МойСклад ${r.total}`];
        if (r.skipped) parts.push(`пропущено ${r.skipped}`);
        statusEl.innerHTML = `✅ Готово: ${parts.join(', ')}`;
        statusEl.innerHTML += `<div style="margin-top:6px;font-size:.85em;color:#64748b">Поставщики: у ${r.withSupplier ?? 0} товаров${r.supplierSample ? ` (напр.: ${esc(r.supplierSample)})` : ' — поле supplier пустое в МойСклад'}</div>`;
        if (r.skipped && r.skipped_details?.length) {
          const sample = r.skipped_details.slice(0, 3).map((s) => `• ${esc(s.name)}${s.sku ? ` (${esc(s.sku)})` : ''}: ${esc(s.error)}`).join('<br>');
          statusEl.innerHTML += `<div style="margin-top:8px;font-size:.9em;opacity:.8">${sample}${r.skipped_details.length > 3 ? `<br>… ещё ${r.skipped_details.length - 3}` : ''}</div>`;
        }
        toast('Импорт завершён', 'success');
        await onDone?.();
        return new Promise((resolve) => setTimeout(() => resolve(true), 1500));
      } catch (e) {
        statusEl.textContent = `❌ ${e.message}`;
        return false;
      }
    },
  });
}

async function openMoyskladStock(onDone) {
  const tokenStatus = await api.moyskladTokenStatus().catch(() => ({ hasToken: false }));
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен МойСклад' });
  const statusEl = el('div', { class: 'import-status' });
  const body = el(
    'div',
    {},
    el('p', {}, 'Быстро обновит только остатки у уже импортированных товаров — без повторной выгрузки каталога.'),
    tokenStatus.hasToken
      ? el('p', { class: 'hint' }, '✓ Токен сохранён в Интеграциях — поле можно не заполнять.')
      : el('div', { class: 'form-row' }, el('label', {}, 'Токен'), tokenI),
    statusEl,
  );
  await openModal('Обновить остатки из МойСклад', body, {
    primaryLabel: 'Обновить остатки',
    onSubmit: async () => {
      statusEl.textContent = '⏳ Обновляю остатки…';
      try {
        const r = await api.refreshMoyskladStock(tokenI.value.trim() || undefined);
        statusEl.innerHTML = `✅ Обновлено остатков: ${r.updated} из ${r.total}`;
        toast('Остатки обновлены', 'success');
        await onDone?.();
        return new Promise((resolve) => setTimeout(() => resolve(true), 1200));
      } catch (e) {
        statusEl.textContent = `❌ ${e.message}`;
        return false;
      }
    },
  });
}

async function openMoyskladStores(onDone) {
  const tokenStatus = await api.moyskladTokenStatus().catch(() => ({ hasToken: false }));
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен МойСклад' });
  const statusEl = el('div', { class: 'import-status' });
  let isLoading = false;
  const body = el(
    'div',
    {},
    el('p', {}, 'Загрузит остатки по складам (на каком складе сколько). Для большого каталога грузится частями — подождите завершения, не закрывайте окно.'),
    tokenStatus.hasToken
      ? el('p', { class: 'hint' }, '✓ Токен сохранён в Интеграциях — поле можно не заполнять.')
      : el('div', { class: 'form-row' }, el('label', {}, 'Токен'), tokenI),
    statusEl,
  );
  await openModal('Остатки по складам', body, {
    primaryLabel: 'Загрузить склады',
    onSubmit: async () => {
      const token = tokenI.value.trim();
      if (!token && !tokenStatus.hasToken) {
        statusEl.innerHTML = '❌ Введите токен или сохраните его в Интеграциях';
        return false;
      }
      isLoading = true;
      statusEl.innerHTML = '⏳ Запрашиваю склады из МойСклад…';
      let offset = 0;
      let totalUpdated = 0;
      let updById = 0;
      let updSku = 0;
      let samples = null;
      let debug = null;
      try {
        for (let i = 0; i < 1000; i += 1) {
          const r = await api.refreshMoyskladStores(token, offset);
          totalUpdated += r.updated || 0;
          updById += r.updatedById || 0;
          updSku += r.updatedBySku || 0;
          if (r.samples && !samples) samples = r.samples;
          if (r.debug && !debug) debug = r.debug;
          offset = r.nextOffset;
          const seen = r.total ? Math.min(offset, r.total) : offset;
          statusEl.innerHTML = `⏳ Обработано ${seen}${r.total ? ' из ' + r.total : ''}…`;
          if (r.done) break;
        }
        let msg = `✅ Готово: склады у <strong>${totalUpdated}</strong> позиций (по id: ${updById}, по артикулу: ${updSku}).`;
        if (debug) {
          msg += `<br><small style="color:#64748b"><strong>Отчёт МойСклада:</strong> ${debug.rowCount} строк, ${debug.byIdCount} с uuid, ${debug.bySkuCount} с артикулом`;
          msg += `<br>Совпали в БД: ${debug.matchedIds.length} по uuid${debug.matchedIds.length > 0 ? ` (${debug.matchedIds.join(', ')})` : ''}`;
          msg += `<br>${debug.matchedSkus.length} по артикулу${debug.matchedSkus.length > 0 ? ` (${debug.matchedSkus.join(', ')})` : ''}`;
          msg += '</small>';
        }
        if (samples && samples.length > 0) {
          msg += `<br><small style="color:#64748b"><strong>Примеры товаров из отчёта:</strong><br>`;
          samples.forEach((s) => {
            msg += `• ${s.article ?? s.code ?? '?'}: uuid=${s.uuid ? '✓' : '✗'}, складов=${s.storeCount}`;
            if (s.stores && s.stores.length > 0) {
              msg += ` → ${s.stores.slice(0, 2).map((st) => `${st.name}:${st.stock}`).join(', ')}`;
            }
            msg += '<br>';
          });
          msg += '</small>';
        }
        statusEl.innerHTML = msg;
        isLoading = false;
        toast('Склады обновлены', 'success');
        // НЕ закрываем окно - пусть пользователь прочитает результаты
        await onDone?.();
      } catch (e) {
        // XSS защита: escapeHTML для e.message
        statusEl.innerHTML = '❌ ' + document.createElement('div').appendChild(document.createTextNode(e.message)).parentNode.innerHTML;
        isLoading = false;
      }
    },
  });
}

// --- Прайсы: шаблон, загрузка, правила цен ---

// Простой парсер CSV: BOM, разделитель ; или , автоопределяется, поддержка кавычек.
function parseCsvText(text) {
  const t = String(text).replace(/^﻿/, '');
  const lines = t.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === sep) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  return { header: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

function findCsvCol(header, ...names) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const H = header.map(norm);
  for (const n of names) {
    const idx = H.indexOf(norm(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

async function openPriceTemplate() {
  let warehouses = [];
  try {
    const w = await api.warehousesList();
    const hidden = new Set(w.hidden || []);
    warehouses = (w.all || []).filter((s) => !hidden.has(s));
  } catch {
    /* складов нет */
  }
  // Канал цен в системе один — «Общий прайс» (см. PROJECT-MAP «Прайсы»).
  // Раньше тут был список площадок из MARKETPLACES — после унификации
  // выгрузка по «Avito» давала пустой шаблон.
  const channelSel = el(
    'select',
    { class: 'select' },
    el('option', { value: 'Общий прайс', selected: true }, 'Общий прайс'),
  );
  const warehouseSel = el(
    'select',
    { class: 'select' },
    el('option', { value: '' }, '— выберите склад —'),
    ...warehouses.map((s) => el('option', { value: s }, s)),
  );
  const body = el(
    'div',
    {},
    el(
      'p',
      {},
      'Скачает CSV со всеми активными товарами: артикул, поставщик, себестоимость, название. Цена задаётся на пару «Канал + Склад» — выберите оба: колонки подставятся, как и текущие цены этой пары. Заполните цены и загрузите файл обратно кнопкой «Загрузить прайс».',
    ),
    el('div', { class: 'form-row' }, el('label', {}, 'Канал продаж *'), channelSel),
    el('div', { class: 'form-row' }, el('label', {}, 'Склад *'), warehouseSel),
    warehouses.length ? null : el('p', { class: 'hint' }, 'Склады ещё не загружены — сначала импортируйте остатки по складам (Каталог → 🏬 Склады).'),
  );
  await openModal('Шаблон прайса', body, {
    primaryLabel: 'Скачать CSV',
    onSubmit: async () => {
      if (!channelSel.value) { toast('Выберите канал продаж', 'error'); return false; }
      if (!warehouseSel.value) { toast('Выберите склад', 'error'); return false; }
      try {
        await api.downloadPriceTemplate(channelSel.value, warehouseSel.value);
        toast('Шаблон скачан', 'success');
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

async function openPriceUpload(onDone) {
  const fileI = el('input', { type: 'file', accept: '.csv,text/csv' });
  const statusEl = el('div', { class: 'import-status' });
  let parsed = null;

  fileI.addEventListener('change', async () => {
    parsed = null;
    statusEl.textContent = '';
    const file = fileI.files && fileI.files[0];
    if (!file) return;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      // .xlsx (и любой zip) начинается с сигнатуры PK — это не CSV.
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        statusEl.innerHTML =
          '❌ Это файл Excel (.xlsx), а нужен CSV. В Excel: «Файл → Сохранить как → CSV (разделители — запятые)» и загрузите получившийся .csv.';
        return;
      }
      // Excel в русской локали часто сохраняет CSV в Windows-1251. Пробуем UTF-8,
      // и если кириллические заголовки не распознались — Windows-1251.
      let rows = [];
      let cSku = -1;
      let cMarket = -1;
      let cWarehouse = -1;
      let cPrice = -1;
      for (const enc of ['utf-8', 'windows-1251']) {
        let text;
        try {
          text = new TextDecoder(enc).decode(buf);
        } catch {
          continue;
        }
        const p = parseCsvText(text);
        const a = findCsvCol(p.header, 'Артикул мойсклад', 'Артикул', 'sku');
        const b = findCsvCol(p.header, 'Канал продаж', 'Канал', 'marketplace');
        const c = findCsvCol(p.header, 'Цена для канала продаж', 'Цена', 'price');
        if (a >= 0 && b >= 0 && c >= 0) {
          rows = p.rows;
          cSku = a;
          cMarket = b;
          cWarehouse = findCsvCol(p.header, 'Склад', 'warehouse'); // необязательная колонка
          cPrice = c;
          break;
        }
      }
      if (cSku < 0 || cMarket < 0 || cPrice < 0) {
        statusEl.innerHTML =
          '❌ Не нашёл нужные колонки. Нужны: «Артикул мойсклад», «Канал продаж», «Склад», «Цена для канала продаж». Скачайте шаблон кнопкой «Шаблон прайса» и не меняйте названия колонок.';
        return;
      }
      if (cWarehouse < 0) {
        statusEl.innerHTML =
          '❌ В файле нет колонки «Склад». Цена задаётся на пару «Канал + Склад» — скачайте свежий шаблон кнопкой «Шаблон прайса» (там нужно выбрать склад).';
        return;
      }
      const out = [];
      let skippedEmpty = 0;
      let skippedNoWarehouse = 0;
      for (const r of rows) {
        // Убираем Excel-обёртку ="..." (текстовый формат длинных артикулов).
        const sku = (r[cSku] || '').trim().replace(/^=?"(.*)"$/, '$1').trim();
        const marketplace = (r[cMarket] || '').trim();
        const warehouse = (r[cWarehouse] || '').trim();
        const priceRaw = (r[cPrice] || '').trim().replace(/\s/g, '').replace(/₽/g, '').replace(',', '.');
        const price = Number(priceRaw);
        if (!sku || !marketplace || !priceRaw || !Number.isFinite(price) || price < 0) {
          skippedEmpty += 1;
          continue;
        }
        // Строгая модель: цена без склада не имеет смысла — пропускаем.
        if (!warehouse) {
          skippedNoWarehouse += 1;
          continue;
        }
        out.push({ sku, marketplace, warehouse, price });
      }
      parsed = out;
      const extra = [
        skippedEmpty ? `пустых/без цены: ${skippedEmpty}` : '',
        skippedNoWarehouse ? `без склада: ${skippedNoWarehouse}` : '',
      ].filter(Boolean).join(' · ');
      statusEl.innerHTML = out.length
        ? `📋 Готово к загрузке: <strong>${out.length}</strong> строк${extra ? ` · пропущено ${extra}` : ''}. Нажмите «Загрузить».`
        : (skippedNoWarehouse
            ? '❌ Во всех строках с ценой не заполнен «Склад». Скачайте шаблон с выбранным складом или впишите склад в колонку «Склад».'
            : '❌ Не нашёл ни одной строки с заполненной ценой. Заполните колонку «Цена для канала продаж».');
    } catch (e) {
      statusEl.textContent = `❌ Не удалось прочитать файл: ${e.message}`;
    }
  });

  const body = el(
    'div',
    {},
    el(
      'p',
      {},
      'Загрузите CSV из шаблона: проставьте «Канал продаж», «Склад» и «Цена для канала продаж». Цена привязывается к паре канал+склад. Товары находятся по «Артикул мойсклад». Пустые строки и строки без цены пропускаются — можно грузить частями.',
    ),
    el(
      'p',
      { class: 'hint' },
      'Из Excel сохраняйте как «CSV (разделители — запятые)». Если Excel предложит создать новый файл — соглашайтесь, это нормально. Кодировку выбирать не нужно: понимаем и UTF-8, и Windows-1251. Названия колонок не меняйте.',
    ),
    el('div', { class: 'form-row' }, el('label', {}, 'Файл CSV'), fileI),
    statusEl,
  );

  await openModal('Загрузка прайса', body, {
    primaryLabel: 'Загрузить',
    onSubmit: async () => {
      if (!parsed || !parsed.length) {
        statusEl.innerHTML = '❌ Сначала выберите CSV с заполненными ценами.';
        return false;
      }
      statusEl.textContent = '⏳ Загружаю цены…';
      try {
        const r = await api.importPrices(parsed);
        statusEl.innerHTML =
          `✅ Обновлено цен: <strong>${r.upserted}</strong> из ${r.total}` +
          (r.notFound ? ` · не найдено по артикулу: ${r.notFound}` : '') +
          (r.skippedNoWarehouse ? ` · пропущено без склада: ${r.skippedNoWarehouse}` : '');
        toast('Прайс загружен', 'success');
        await onDone?.();
        return new Promise((resolve) => setTimeout(() => resolve(true), 1800));
      } catch (e) {
        statusEl.textContent = `❌ ${e.message}`;
        return false;
      }
    },
  });
}

async function openImportNamesModal(onDone) {
  const csvI = el('textarea', { rows: '10', placeholder: 'артикул;название\nарт2;название2\n...', style: { width: '100%', fontFamily: 'monospace', fontSize: '13px' } });
  const resultDiv = el('div', { style: { marginTop: '8px', fontSize: '13px' } });
  const body = el('div', {},
    el('p', { style: { marginTop: 0 } }, 'CSV: одна строка — артикул и название через «;» или «,». Первый столбец — артикул или external_id.'),
    csvI,
    resultDiv,
  );
  await openModal('✏️ Обновить названия товаров', body, {
    primaryLabel: 'Обновить',
    onSubmit: async () => {
      const csv = csvI.value.trim();
      if (!csv) { toast('Вставьте CSV', 'error'); return false; }
      try {
        const r = await api.importProductNames(csv);
        clear(resultDiv);
        resultDiv.append(el('div', { style: { color: 'green' } }, `Обновлено: ${r.matched} из ${r.total}`));
        if (r.notFound?.length) {
          resultDiv.append(el('div', { style: { color: '#b45309', marginTop: '4px' } }, `Не найдены: ${r.notFound.join(', ')}`));
        }
        onDone?.();
        return false;
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

async function openPricingSettings() {
  let settings;
  try {
    settings = await api.pricingSettings();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const methods = settings.payment_methods || [];
  const tiers = settings.order_tiers || [];

  const pmInputs = [];
  const pmArea = el('div', { class: 'pricing-list' });
  for (const m of methods) {
    const inp = el('input', { type: 'number', step: 'any', value: m.percent ?? 0, style: { width: '90px' } });
    pmInputs.push({ key: m.key, label: m.label, input: inp });
    pmArea.append(
      el(
        'div',
        { class: 'pricing-row' },
        el('span', { class: 'pricing-label' }, m.label),
        inp,
        el('span', { class: 'pricing-suffix' }, '%'),
      ),
    );
  }

  const tiersArea = el('div', { class: 'pricing-list' });
  const tierRows = [];
  function addTierRow(t = {}) {
    const fromI = el('input', {
      type: 'number',
      step: 'any',
      min: '0',
      value: t.threshold ?? '',
      placeholder: 'сумма, ₽',
      style: { width: '130px' },
    });
    const pctI = el('input', { type: 'number', step: 'any', value: t.percent ?? '', placeholder: '%', style: { width: '90px' } });
    const ref = { fromI, pctI };
    const row = el(
      'div',
      { class: 'pricing-row' },
      el('span', { class: 'pricing-label' }, 'От'),
      fromI,
      el('span', { class: 'pricing-suffix' }, '₽ →'),
      pctI,
      el('span', { class: 'pricing-suffix' }, '%'),
      el(
        'button',
        {
          type: 'button',
          class: 'remove-btn',
          onClick: () => {
            row.remove();
            const i = tierRows.indexOf(ref);
            if (i >= 0) tierRows.splice(i, 1);
          },
        },
        '×',
      ),
    );
    ref.row = row;
    tierRows.push(ref);
    tiersArea.append(row);
  }
  tiers.forEach((t) => addTierRow(t));

  const body = el(
    'div',
    { class: 'pricing-settings' },
    el('h3', { class: 'pricing-h3' }, 'Скидки / надбавки по способу оплаты'),
    el(
      'p',
      { class: 'hint' },
      'Процент к цене из прайса. Минус — скидка, плюс — надбавка. Например, «На РС (С НДС)» = +20.',
    ),
    pmArea,
    el('h3', { class: 'pricing-h3', style: { marginTop: '18px' } }, 'Скидки по сумме заказа'),
    el(
      'p',
      { class: 'hint' },
      'Пороги задаёте сами: при сумме заказа от указанной применяется процент (минус — скидка). Берётся наибольший подходящий порог.',
    ),
    tiersArea,
    el('button', { type: 'button', class: 'btn btn-sm', style: { marginTop: '8px' }, onClick: () => addTierRow() }, '+ Добавить порог'),
  );

  await openModal('Правила цен', body, {
    primaryLabel: 'Сохранить',
    size: 'lg',
    onSubmit: async () => {
      const payment_methods = pmInputs.map((p) => ({
        key: p.key,
        label: p.label,
        percent: Number(p.input.value) || 0,
      }));
      const order_tiers = [];
      for (const r of tierRows) {
        if (r.fromI.value === '') continue;
        const threshold = Number(r.fromI.value);
        const percent = Number(r.pctI.value);
        if (!Number.isFinite(threshold) || threshold < 0) continue;
        order_tiers.push({ threshold, percent: Number.isFinite(percent) ? percent : 0 });
      }
      try {
        await api.savePricingSettings({ payment_methods, order_tiers });
        toast('Правила цен сохранены', 'success');
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
  });
}

// Статус ознакомления продающих с актуальным прайсом (для админа).
async function openPriceAckStatus() {
  let data;
  try {
    data = await api.priceAckStatus();
  } catch (e) {
    toast(e.message || 'Не удалось загрузить статус', 'error');
    return;
  }
  const when = data.revision_at ? fmtDateTime(data.revision_at) : '—';
  const head = el('div', { style: { marginBottom: '10px' } },
    el('div', {}, `Прайс обновлён: ${when}`),
    el('div', { style: { fontWeight: '600', marginTop: '4px' } },
      `Подтвердили: ${data.confirmed} из ${data.total}`),
  );
  const rows = (data.managers || []).map((m) => el('tr', {},
    el('td', {}, m.name || m.email || `#${m.id}`),
    el('td', {}, tr('role', m.role) || m.role),
    el('td', {},
      m.is_current
        ? el('span', { style: { color: '#16a34a' } }, '✅ ознакомлен')
        : el('span', { style: { color: '#dc2626' } }, '❌ не подтвердил')),
    el('td', {}, m.acknowledged_at ? fmtDateTime(m.acknowledged_at) : '—'),
  ));
  const table = el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Менеджер'), el('th', {}, 'Роль'),
      el('th', {}, 'Статус'), el('th', {}, 'Когда подтвердил'))),
    el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colspan: '4' }, 'Нет продающих менеджеров'))])),
  );
  await openModal('Ознакомление с прайсом', el('div', {}, head, table));
}

// ============================================================
// Аналитика для руководства
// ============================================================

export async function renderAnalytics(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (!['admin', 'manager'].includes(me.role)) {
    main.append(
      el('div', { class: 'empty' }, 'Раздел доступен только администраторам и менеджерам.'),
    );
    return;
  }

  let days = 30;

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el(
        'div',
        {},
        el('h1', { class: 'page-title' }, 'Аналитика'),
        el(
          'div',
          { class: 'page-subtitle' },
          'Сводка для руководства: выручка, лидеры, площадки, товары, воронка.',
        ),
      ),
    ),
  );

  const periodSelect = el(
    'select',
    {
      onChange: (e) => {
        days = Number(e.target.value);
        reload();
      },
    },
    el('option', { value: '7' }, 'За 7 дней'),
    el('option', { value: '30', selected: true }, 'За 30 дней'),
    el('option', { value: '90' }, 'За 90 дней'),
    el('option', { value: '365' }, 'За год'),
  );
  main.append(
    el(
      'div',
      { class: 'toolbar', style: { marginBottom: '16px' } },
      el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Период:'),
      periodSelect,
    ),
  );

  const summaryArea = el('div');
  const revenueArea = el('div', { class: 'dashboard-section' });
  const managersArea = el('div', { class: 'dashboard-section' });
  const marketplacesArea = el('div', { class: 'dashboard-section' });
  const productsArea = el('div', { class: 'dashboard-section' });
  const funnelArea = el('div', { class: 'dashboard-section' });
  main.append(summaryArea, revenueArea, managersArea, marketplacesArea, productsArea, funnelArea);

  async function reload() {
    summaryArea.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
    revenueArea.replaceChildren();
    managersArea.replaceChildren();
    marketplacesArea.replaceChildren();
    productsArea.replaceChildren();
    funnelArea.replaceChildren();

    try {
      const [summary, revenue, managers, marketplaces, products, funnel] = await Promise.all([
        api.analyticsSummary(days),
        api.analyticsRevenue(days),
        api.analyticsManagers(days),
        api.analyticsMarketplaces(days),
        api.analyticsProducts(days),
        api.analyticsFunnel(days),
      ]);

      renderSummary(summaryArea, summary);
      renderRevenueChart(revenueArea, revenue);
      renderManagersTable(managersArea, managers);
      renderMarketplacesTable(marketplacesArea, marketplaces);
      renderProductsTable(productsArea, products);
      renderFunnel(funnelArea, funnel);
    } catch (e) {
      summaryArea.replaceChildren(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  reload();
}

function renderSummary(area, s) {
  area.replaceChildren(
    el(
      'div',
      { class: 'dashboard-grid' },
      statCard('Выручка', fmtMoney(s.revenue.total, 'RUB'), `${s.revenue.completed_orders} заказов`),
      statCard('Средний чек', fmtMoney(s.revenue.avg_order_value, 'RUB')),
      statCard(
        'Сделки выиграны',
        s.deals.won,
        `Конверсия: ${(s.deals.win_rate * 100).toFixed(0)}%`,
      ),
      statCard(
        'Открытые сделки',
        s.deals.open,
        `Сумма: ${fmtMoney(s.deals.won_amount, 'RUB')}`,
      ),
    ),
    el(
      'div',
      { class: 'dashboard-grid', style: { marginTop: '12px' } },
      statCard('Новые лиды', s.customers.new_leads),
      statCard('Новые контакты', s.customers.new_contacts),
      statCard('Новые компании', s.customers.new_companies),
      statCard(
        'Заказы',
        `${s.orders.new_orders + s.orders.reserved_orders + s.orders.shipped_orders}`,
        `${s.orders.reserved_orders} зарез. · ${s.orders.shipped_orders} отгр.`,
      ),
    ),
  );
}

function renderRevenueChart(area, r) {
  const points = r.points || [];
  if (points.length === 0) {
    area.append(
      el('h3', {}, 'Выручка по дням'),
      el('div', { class: 'card empty' }, 'Нет завершённых заказов за период.'),
    );
    return;
  }
  const max = Math.max(...points.map((p) => p.revenue), 1);
  area.append(
    el('h3', {}, 'Выручка по дням'),
    el(
      'div',
      { class: 'card chart-card' },
      el(
        'div',
        { class: 'revenue-chart' },
        ...points.map((p) => {
          const h = Math.max(2, Math.round((p.revenue / max) * 100));
          return el(
            'div',
            { class: 'revenue-bar', title: `${p.date}: ${fmtMoney(p.revenue, 'RUB')}` },
            el(
              'div',
              {
                class: 'revenue-bar-fill',
                style: { height: h + '%' },
              },
            ),
            el(
              'div',
              { class: 'revenue-bar-label' },
              new Date(p.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
            ),
          );
        }),
      ),
    ),
  );
}

function renderManagersTable(area, m) {
  const rows = m.data || [];
  area.append(el('h3', {}, 'Топ менеджеров'));
  if (rows.length === 0) {
    area.append(el('div', { class: 'card empty' }, 'Нет данных по менеджерам.'));
    return;
  }
  const maxRevenue = Math.max(...rows.map((r) => r.revenue), 1);
  area.append(
    el(
      'div',
      { class: 'card' },
      ...rows.map((u) =>
        el(
          'div',
          { class: 'manager-row' },
          el('div', { class: 'manager-name' }, u.name, ' ', el('span', { class: 'hint' }, tr('role', u.role))),
          el(
            'div',
            { class: 'manager-bar' },
            el(
              'div',
              {
                class: 'manager-bar-fill',
                style: { width: `${(u.revenue / maxRevenue) * 100}%` },
              },
            ),
          ),
          el(
            'div',
            { class: 'manager-stats' },
            el('strong', {}, fmtMoney(u.revenue, 'RUB')),
            el('div', { class: 'hint' }, `${u.orders_count} заказов · ${u.deals_won} сделок`),
          ),
        ),
      ),
    ),
  );
}

function renderMarketplacesTable(area, m) {
  const rows = m.data || [];
  area.append(el('h3', {}, 'Выручка по площадкам'));
  if (rows.length === 0) {
    area.append(el('div', { class: 'card empty' }, 'Нет данных.'));
    return;
  }
  area.append(
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Площадка'),
            el('th', {}, 'Заказов'),
            el('th', {}, 'Выручка'),
            el('th', {}, 'Средний чек'),
          ),
        ),
        el(
          'tbody',
          {},
          ...rows.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, el('strong', {}, r.marketplace)),
              el('td', {}, r.orders_count),
              el('td', {}, fmtMoney(r.revenue, 'RUB')),
              el('td', {}, fmtMoney(r.avg_order_value, 'RUB')),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderProductsTable(area, p) {
  const rows = p.data || [];
  area.append(el('h3', {}, 'Топ товаров'));
  if (rows.length === 0) {
    area.append(el('div', { class: 'card empty' }, 'Нет данных.'));
    return;
  }
  area.append(
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { style: { width: '50px' } }, ''),
            el('th', {}, 'Товар'),
            el('th', {}, 'Артикул'),
            el('th', {}, 'Продано'),
            el('th', {}, 'Выручка'),
            el('th', {}, 'Прибыль'),
          ),
        ),
        el(
          'tbody',
          {},
          ...rows.map((r) =>
            el(
              'tr',
              {},
              el(
                'td',
                {},
                r.image_url
                  ? el('img', { src: r.image_url, class: 'item-thumb', alt: '' })
                  : el('div', { class: 'item-thumb item-thumb-empty' }, '—'),
              ),
              el('td', {}, el('strong', {}, r.name)),
              el('td', {}, r.sku ? el('code', {}, r.sku) : '—'),
              el('td', {}, r.units_sold + ' шт'),
              el('td', {}, fmtMoney(r.revenue, 'RUB')),
              el(
                'td',
                {},
                el(
                  'strong',
                  { style: { color: r.profit >= 0 ? 'var(--success)' : 'var(--danger)' } },
                  fmtMoney(r.profit, 'RUB'),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderFunnel(area, f) {
  const leads = f.leads || [];
  const deals = f.deals || [];
  area.append(el('h3', {}, 'Воронка'));
  const card = el('div', { class: 'card' });
  card.append(
    el('div', { style: { fontWeight: '600', marginBottom: '6px' } }, 'Лиды'),
    ...renderBars(
      leads.map((r) => ({ label: tr('status', r.status), count: r.count })),
      'label',
      'count',
    ),
    el('div', { style: { fontWeight: '600', marginTop: '14px', marginBottom: '6px' } }, 'Сделки'),
    ...renderBars(
      deals.map((r) => ({ label: tr('stage', r.stage), count: r.count })),
      'label',
      'count',
    ),
  );
  area.append(card);
}

// ============================================================
// Возвраты (отменённые заказы с зарезервированным/отгруженным товаром)
// ============================================================

export async function renderReturns(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canResolve = ['warehouse', 'admin'].includes(me.role);

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Возвраты'),
        el('div', { class: 'page-subtitle' }, 'Отменённые заказы: вернуть товар в сток или списать с подтверждением'),
      ),
    ),
    el('div', { class: 'help-row' }, helpButton('returns')),
  );

  const container = el('div');
  main.append(container);

  async function load() {
    container.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.returnsList();
      const rows = r.data || [];
      container.replaceChildren();
      if (!rows.length) {
        container.append(emptyState({ icon: '↩️', title: 'Возвратов нет', description: 'Отменённые заказы с товаром появятся здесь.' }));
        return;
      }
      const head = el('tr', {},
        el('th', {}, '№'),
        el('th', {}, 'Площадка'),
        el('th', {}, 'Клиент'),
        el('th', {}, 'Сумма'),
        el('th', {}, 'Причина отмены'),
        el('th', {}, 'Статус возврата'),
        el('th', { style: { textAlign: 'right' } }, 'Действия'),
      );
      const body = rows.map((o) => {
        const statusCell = o.return_status === 'pending'
          ? el('span', { class: 'badge pending' }, 'Ждёт обработки')
          : o.return_status === 'restocked'
            ? el('span', { class: 'badge confirmed' }, 'Возвращён в сток')
            : o.return_status === 'markdown'
              ? el('span', { class: 'badge proposal' }, '🏷️ Возвращён в уценку')
              : o.return_status === 'lost'
                ? el('span', { class: 'badge pending' }, 'Потерян')
                : el('span', { class: 'badge rejected' }, 'Списан');
        const actions = el('td', { style: { textAlign: 'right' } });
        if (canResolve && o.return_status === 'pending') {
          actions.append(
            el('button', {
              class: 'btn btn-sm',
              onClick: async () => {
                if (!(await confirm(`Вернуть товар заказа #${o.id} в сток?`))) return;
                try { await api.resolveReturn(o.id, 'restocked'); toast('Возвращён в сток', 'success'); load(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }, '↩️ В сток'),
            el('button', {
              class: 'btn btn-sm',
              onClick: () => openMarkdownDialog(o, load),
            }, '🏷️ Уценка'),
            el('button', {
              class: 'btn btn-sm btn-danger',
              onClick: () => openWriteOff(o, load),
            }, '🗑 Списать'),
            el('button', {
              class: 'btn btn-sm btn-warning',
              onClick: async () => {
                if (!(await confirm(`Отметить товар заказа #${o.id} как потерянный? Попадёт в «Потерянные товары».`))) return;
                try { await api.resolveReturn(o.id, 'lost'); toast('Товар отмечен как потерянный', 'success'); load(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }, '❓ Товар потерян'),
          );
        } else if (o.return_status !== 'pending') {
          const parts = [];
          if (o.resolved_by_name) parts.push(o.resolved_by_name);
          if (o.return_resolved_at) parts.push(fmtDateTime(o.return_resolved_at));
          actions.append(el('span', { class: 'hint' }, parts.join(' · ') || '—'));
          if (o.return_proof) {
            actions.append(' ', el('button', {
              class: 'btn btn-sm',
              onClick: () => {
                const img = el('img', { src: o.return_proof, style: { maxWidth: '100%', borderRadius: '8px' } });
                openModal('Пруф списания', el('div', {}, img), { primaryLabel: null });
              },
            }, '📷 Пруф'));
          }
        }
        return el('tr', {
          style: { cursor: 'pointer' },
          onClick: async (e) => {
            // Клик по ячейке actions (кнопки) — не открывать модалку.
            if (e.target.closest('button')) return;
            try {
              const full = await api.get('orders', o.id);
              await showOrderDetails(full, load);
            } catch (err) {
              toast(err.message || 'Не удалось открыть заказ', 'error');
            }
          },
        },
          el('td', {}, '#' + o.id),
          el('td', {}, o.marketplace || '—'),
          el('td', {}, o.client_name || '—'),
          el('td', {}, fmtMoney(o.total_amount, o.currency)),
          el('td', {}, o.cancel_reason || '—'),
          el('td', {}, statusCell),
          actions,
        );
      });
      container.append(el('div', { class: 'hint', style: { marginBottom: '8px' } },
        '💡 Клик по строке открывает полную карточку заказа.'));
      container.append(el('div', { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))));
    } catch (e) {
      container.replaceChildren(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  // Уценка: товар вернулся в плохом состоянии, но продаваем дешевле. Создаём новый
  // товар (в CRM и МС) на склад уценки, требуем фото-пруф, ставим админу задачу
  // проставить цену.
  function openMarkdownDialog(order, onDone) {
    let proofData = '';
    const preview = el('div', { class: 'qr-preview' });
    const fileI = el('input', { type: 'file', accept: 'image/*' });
    fileI.addEventListener('change', () => {
      const f = fileI.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        proofData = reader.result;
        preview.replaceChildren(el('img', { src: proofData, style: { maxWidth: '200px', borderRadius: '8px' } }));
      };
      reader.readAsDataURL(f);
    });
    const body = el('div', {},
      el('p', {}, `Уценка по заказу #${order.id}. На каждую позицию создастся новый товар в каталоге, оприходуется на склад «${'Склад МСК (Электросталь) УЦЕНКА'}» в МС. Админ получит уведомление — нужно проставить цену.`),
      el('div', { class: 'form-row' }, el('label', {}, 'Фото-пруф состояния *'), fileI, preview),
    );
    openModal('Перевести в уценку', body, {
      primaryLabel: 'Уценить',
      onSubmit: async () => {
        if (!proofData) { toast('Приложите фото-пруф состояния товара', 'error'); return false; }
        // Загрузка фото в МС может занимать 5-15 сек: показываем индикатор
        // прямо в теле диалога, чтобы пользователь видел что окно не зависло.
        const loadingBlock = el('div', {
          style: { padding: '16px', textAlign: 'center', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', marginTop: '8px' },
        }, '⏳ Создаём уценку и загружаем фото в МойСклад…');
        body.appendChild(loadingBlock);
        try {
          await api.resolveReturn(order.id, 'markdown', proofData);
          toast('Товар уценён. Админу отправлено уведомление проставить цену.', 'success');
          onDone?.();
        } catch (e) {
          loadingBlock.remove();
          toast(e.message, 'error');
          return false;
        }
      },
    });
  }

  // Списание с обязательным фото-пруфом.
  function openWriteOff(order, onDone) {
    let proofData = '';
    const preview = el('div', { class: 'qr-preview' });
    const fileI = el('input', { type: 'file', accept: 'image/*' });
    fileI.addEventListener('change', () => {
      const f = fileI.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        proofData = reader.result;
        preview.replaceChildren(el('img', { src: proofData, style: { maxWidth: '200px', borderRadius: '8px' } }));
      };
      reader.readAsDataURL(f);
    });
    const body = el('div', {},
      el('p', {}, `Списание товара по заказу #${order.id}. Приложите фото — подтверждение, что товар негоден.`),
      el('div', { class: 'form-row' }, el('label', {}, 'Фото-пруф *'), fileI, preview),
    );
    openModal('Списать товар', body, {
      primaryLabel: 'Списать',
      onSubmit: async () => {
        if (!proofData) { toast('Приложите фото-подтверждение', 'error'); return false; }
        try {
          await api.resolveReturn(order.id, 'written_off', proofData);
          toast('Товар списан', 'success');
          onDone?.();
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    });
  }

  load();
}

// ============================================================
// Потерянные товары (учёт потерь; аннулирует только админ)
// ============================================================

export async function renderLostGoods(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = me.role === 'admin';
  let filter = 'new'; // new | settled | all

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Потерянные товары'),
        el('div', { class: 'page-subtitle' }, 'Товары, отмеченные как потерянные при обработке возвратов. Сумма — по цене продажи.'),
      ),
    ),
  );

  const totalCard = el('div', { class: 'card', style: { marginBottom: '16px' } });
  const filterBar = el('div', { class: 'filter-bar', style: { marginBottom: '12px' } });
  const container = el('div');
  main.append(totalCard, filterBar, container);

  const filters = [
    { key: 'new', label: 'Новые' },
    { key: 'settled', label: 'Погашенные' },
    { key: 'all', label: 'Все' },
  ];
  function renderFilterBar() {
    clear(filterBar);
    filters.forEach((f) => {
      filterBar.append(
        el('button', {
          class: `btn btn-sm ${filter === f.key ? 'btn-primary' : ''}`,
          onClick: () => { filter = f.key; load(); },
        }, f.label),
      );
    });
  }

  async function load() {
    renderFilterBar();
    container.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.lostList(filter === 'all' ? '' : filter);
      const rows = r.data || [];
      clear(totalCard);
      totalCard.append(
        el('div', { class: 'hint' }, 'Общая сумма потерь (без аннулированных)'),
        el('div', { style: { fontSize: '24px', fontWeight: '700', marginTop: '4px', color: 'var(--danger)' } },
          fmtMoney(r.total_loss || 0, 'RUB')),
      );
      container.replaceChildren();
      if (!rows.length) {
        container.append(emptyState({ icon: '📉', title: 'Потерь нет', description: 'Товары, отмеченные как потерянные в возвратах, появятся здесь.' }));
        return;
      }
      const head = el('tr', {},
        el('th', {}, '№'),
        el('th', {}, 'Площадка'),
        el('th', {}, 'Клиент'),
        el('th', {}, 'Склад'),
        el('th', {}, 'Сумма'),
        el('th', {}, 'Причина отмены'),
        el('th', {}, 'Дата'),
        el('th', {}, 'Статус'),
        el('th', { style: { textAlign: 'right' } }, 'Действия'),
      );
      const body = rows.map((o) => {
        const voided = o.loss_voided === true || o.loss_voided === 't';
        const actions = el('td', { style: { textAlign: 'right' } });
        if (isAdmin && !voided) {
          actions.append(
            el('button', {
              class: 'btn btn-sm',
              onClick: async () => {
                if (!(await confirm(`Аннулировать потерю по заказу #${o.id}? Перестанет считаться в сумме потерь.`))) return;
                try { await api.voidLoss(o.id); toast('Потеря аннулирована', 'success'); load(); }
                catch (e) { toast(e.message, 'error'); }
              },
            }, 'Аннулировать'),
          );
        } else {
          actions.append(el('span', { class: 'hint' }, '—'));
        }
        return el('tr', {},
          el('td', {}, '#' + o.id),
          el('td', {}, o.marketplace || '—'),
          el('td', {}, o.client_name || '—'),
          el('td', {}, o.warehouse || '—'),
          el('td', {}, fmtMoney(o.total_amount, o.currency)),
          el('td', {}, o.cancel_reason || '—'),
          el('td', {}, fmtDateTime(o.return_resolved_at || o.cancelled_at)),
          el('td', {}, voided
            ? el('span', { class: 'badge confirmed' }, 'Погашен')
            : el('span', { class: 'badge pending' }, 'Новый')),
          actions,
        );
      });
      container.append(el('div', { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))));
    } catch (e) {
      container.replaceChildren(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  load();
}

// ============================================================
// Расписание отгрузок (для склада + менеджеров)
// ============================================================

export async function renderShipping(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit = ['warehouse', 'admin'].includes(me.role);

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el(
        'div',
        {},
        el('h1', { class: 'page-title' }, 'График отгрузок'),
        el(
          'div',
          { class: 'page-subtitle' },
          canEdit
            ? 'Настройте дни и время отсечки. Заказы будут отгружаться в эти дни. Менеджеры видят ближайшую дату.'
            : 'Расписание устанавливает склад. Здесь показана ближайшая дата отгрузки.',
        ),
      ),
    ),
    canEdit
      ? el('div', { class: 'help-row' }, helpButton('shipping'))
      : null,
  );

  // Фильтр по складу (только для admin)
  let warehouseFilter = '';
  let warehouseOptions = [];
  if (me.role === 'admin') {
    try {
      const wRes = await api.warehousesList();
      warehouseOptions = (wRes.warehouses || wRes || []);
    } catch (_) { /* ignore */ }
  }

  const filterBar = me.role === 'admin' && warehouseOptions.length > 0
    ? (() => {
        const sel = el('select', { class: 'form-select', style: { display: 'inline-block', width: 'auto', marginRight: '8px' } },
          el('option', { value: '' }, 'Все склады'),
          ...warehouseOptions.map((w) => el('option', { value: w }, w)),
        );
        sel.addEventListener('change', () => { warehouseFilter = sel.value; load(); });
        return el('div', { style: { marginBottom: '12px' } }, el('label', { style: { marginRight: '6px' } }, 'Склад:'), sel);
      })()
    : null;

  if (filterBar) main.append(filterBar);

  const container = el('div');
  main.append(container);

  async function load() {
    container.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const params = warehouseFilter ? { warehouse: warehouseFilter } : undefined;
      const [schedule, readyList] = await Promise.all([api.warehouseSchedule(), api.readyToShip(params)]);
      renderContent(container, schedule, readyList, canEdit, load);
    } catch (e) {
      container.replaceChildren(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  load();
}

function renderContent(container, schedule, readyList, canEdit, reload) {
  container.replaceChildren();

  const WEEKDAYS = [
    { code: 'mon', label: 'Пн' },
    { code: 'tue', label: 'Вт' },
    { code: 'wed', label: 'Ср' },
    { code: 'thu', label: 'Чт' },
    { code: 'fri', label: 'Пт' },
    { code: 'sat', label: 'Сб' },
    { code: 'sun', label: 'Вс' },
  ];
  const selected = new Set(schedule.days_list || []);
  const next = schedule.next_shipping_date
    ? new Date(schedule.next_shipping_date)
    : null;
  const cutoffI = el('input', {
    type: 'time',
    value: schedule.cutoff_time || '14:00',
    disabled: canEdit ? null : true,
  });
  const notesI = el('textarea', { rows: '2', disabled: canEdit ? null : true }, schedule.notes || '');

  // Карточка с следующей датой отгрузки
  container.append(
    el(
      'div',
      { class: 'card', style: { marginBottom: '16px' } },
      el('div', { class: 'hint' }, 'Ближайшая дата отгрузки'),
      el(
        'div',
        { style: { fontSize: '24px', fontWeight: '700', marginTop: '4px' } },
        next
          ? new Intl.DateTimeFormat('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Moscow',
            }).format(next) + ' МСК'
          : '—',
      ),
      el(
        'div',
        { class: 'hint', style: { marginTop: '6px' } },
        `${(readyList.data || []).length} заказов готовы к отгрузке`,
      ),
    ),
  );

  // Чекбоксы дней
  const dayCheckboxes = WEEKDAYS.map((d) => {
    const input = el('input', {
      type: 'checkbox',
      checked: selected.has(d.code) ? true : false,
      disabled: canEdit ? null : true,
    });
    return { code: d.code, input, label: d.label };
  });

  container.append(
    el(
      'div',
      { class: 'card' },
      el('h3', {}, 'Дни отгрузки'),
      el(
        'div',
        { class: 'shipping-days' },
        ...dayCheckboxes.map((d) =>
          el('label', { class: 'shipping-day' }, d.input, el('span', {}, d.label)),
        ),
      ),
      el('div', { class: 'form-row', style: { marginTop: '14px' } },
        el('label', {}, 'Время отсечки (HH:MM)'),
        cutoffI,
        el(
          'div',
          { class: 'hint' },
          'После этого времени заказ переносится на следующий день отгрузки.',
        ),
      ),
      el(
        'div',
        { class: 'form-row' },
        el('label', {}, 'Заметки'),
        notesI,
      ),
      canEdit
        ? el(
            'button',
            {
              class: 'btn btn-primary',
              onClick: async () => {
                const days = dayCheckboxes.filter((d) => d.input.checked).map((d) => d.code);
                if (days.length === 0) {
                  toast('Выберите хотя бы один день', 'error');
                  return;
                }
                try {
                  await api.updateWarehouseSchedule({
                    days,
                    cutoff_time: cutoffI.value || '14:00',
                    notes: notesI.value || null,
                  });
                  toast('Сохранено', 'success');
                  reload();
                } catch (e) {
                  toast(e.message, 'error');
                }
              },
            },
            'Сохранить расписание',
          )
        : null,
    ),
  );

  // Список заказов готовых к отгрузке
  const orders = readyList.data || [];
  const FLAT_KEY = 'shipping_flat_list';
  let flatMode = localStorage.getItem(FLAT_KEY) === '1';

  if (orders.length > 0) {
    const selected = new Set();

    const shipSelected = async (ids) => {
      if (!ids.length) {
        toast('Выберите заказы', 'error');
        return;
      }
      // Проверяем что для всех выбранных есть напечатанная этикетка. Если нет —
      // показываем список и требуем явное подтверждение (менеджер иначе
      // «отгружает» заказы, для которых наклейку никто не печатал).
      const notPrinted = ids
        .map((id) => orders.find((o) => o.id === id))
        .filter((o) => o && !o.label_printed_at);
      if (notPrinted.length) {
        const list = notPrinted.map((o) => `#${o.id}`).join(', ');
        if (!(await confirm(
          `⚠️ У ${notPrinted.length} из ${ids.length} заказов этикетка НЕ печаталась: ${list}.\n\n` +
          `Обычно это значит что склад их физически не отгрузил. Продолжить и всё равно отметить их как отгруженные?`,
        ))) return;
      } else {
        if (!(await confirm(`Подтвердить отгрузку ${ids.length} заказов?`))) return;
      }
      try {
        const r = await api.shipBulk(ids);
        toast(`Отгружено: ${r.shipped}`, 'success');
        reload();
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const actions = el('div', { class: 'shipping-actions', style: { marginBottom: '12px' } });
    actions.append(
      el(
        'button',
        {
          class: 'btn',
          onClick: async () => {
            try {
              await api.downloadOrdersCsv({ status: 'reserved' });
              toast('Excel-файл сохранён', 'success');
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        '⬇ Выгрузить в Excel',
      ),
      el(
        'button',
        {
          class: 'btn',
          title: 'PDF с этикетками 58×40 мм: штрих-код, № и служба доставки',
          onClick: async () => {
            const ids = selected.size ? [...selected] : orders.map((o) => o.id);
            if (!ids.length) { toast('Нет заказов для печати', 'error'); return; }
            try {
              const r = await api.downloadLabelsPdf(ids);
              if (r.skipped > 0) {
                toast(`Напечатано ${r.printed} из ${ids.length}. ПРОПУЩЕНО ${r.skipped} без QR: #${r.skipped_ids.join(', #')}. Заполните QR и повторите.`, 'error');
              } else {
                toast(`Этикетки сохранены (${r.printed} шт). Факт печати сохранён.`, 'success');
              }
              // Перерисовываем — покажутся зелёные бейджи «🖨 ✓».
              setTimeout(() => reload(), 500);
            } catch (e) {
              toast(e.message || 'Не удалось сгенерировать PDF', 'error');
            }
          },
        },
        '🏷 Этикетки PDF',
      ),
    );
    if (canEdit) {
      actions.append(
        el('button', { class: 'btn btn-primary', onClick: () => shipSelected([...selected]) }, '✓ Отгрузить выбранные'),
        el('button', { class: 'btn', onClick: () => shipSelected(orders.map((o) => o.id)) }, '✓ Отгрузить все'),
      );
    }
    // Фильтр «Только без напечатанной этикетки» — быстрая проверка что склад
    // ничего не пропустил.
    const notPrintedCount = orders.filter((o) => !o.label_printed_at).length;
    const notPrintedToggle = el('label', {
      style: { marginLeft: '12px', fontSize: '13px', cursor: 'pointer',
        padding: '4px 10px', background: notPrintedCount ? '#fee2e2' : '#f3f4f6',
        border: `1px solid ${notPrintedCount ? '#fca5a5' : '#e5e7eb'}`, borderRadius: '4px' },
    },
      el('input', { type: 'checkbox', id: 'shipping_filter_not_printed' }),
      ` 🚫 Только без напечатанной этикетки${notPrintedCount ? ` (${notPrintedCount})` : ''}`,
    );
    actions.append(notPrintedToggle);
    // Обработчик фильтра: скрываем/показываем строки с/без этикетки.
    setTimeout(() => {
      const cb = document.getElementById('shipping_filter_not_printed');
      if (cb) cb.addEventListener('change', () => {
        document.querySelectorAll('tr').forEach((tr) => {
          if (!tr.classList.contains('ship-row-no-label') && (tr.querySelector('.ship-row-cb') || tr.dataset.oid)) {
            // Строка с чекбоксом отгрузки — но не «no-label»: значит есть этикетка.
            if (cb.checked) tr.style.display = 'none';
            else tr.style.display = '';
          }
        });
      });
    }, 100);

    const headRow = el('tr', {});
    if (canEdit) {
      const selectAll = el('input', { type: 'checkbox' });
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.ship-row-cb').forEach((cb) => {
          cb.checked = selectAll.checked;
          const id = Number(cb.dataset.id);
          if (selectAll.checked) selected.add(id);
          else selected.delete(id);
        });
      });
      headRow.append(el('th', { style: { width: '36px' } }, selectAll));
    }
    headRow.append(
      el('th', {}, '№'),
      el('th', {}, 'Площадка'),
      el('th', {}, 'Клиент'),
      el('th', {}, 'Способ оплаты'),
      el('th', {}, 'QR'),
      el('th', { title: 'Была ли распечатана этикетка' }, '🖨'),
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Зарезервирован'),
      el('th', {}, 'Сумма'),
    );
    if (canEdit) headRow.append(el('th', {}, 'Действия'));

    function makeRows(list) {
      return list.map((o) => {
        const rowEl = el('tr', {
          style: { cursor: 'pointer' },
          onClick: async (e) => {
            if (e.target.closest('button, input, a, label')) return;
            try {
              const full = await api.get('orders', o.id);
              await showOrderDetails(full, reload);
            } catch (err) { toast(err.message, 'error'); }
          },
        });
        if (canEdit) {
          const cb = el('input', { type: 'checkbox', class: 'ship-row-cb' });
          cb.dataset.id = String(o.id);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(o.id);
            else selected.delete(o.id);
          });
          rowEl.append(el('td', {}, cb));
        }
        const needQr = o.marketplace === 'Avito' && o.payment_method === 'avito_delivery';
        // Флаг печати этикетки: если reserved и не печаталась — красный бейдж.
        const printCell = o.label_printed_at
          ? el('span', { title: `Напечатано ${fmtDateTime(o.label_printed_at)} (раз: ${o.label_print_count || 1})`, style: { color: '#059669', fontWeight: '600' } }, '🖨 ' + (o.label_print_count > 1 ? `×${o.label_print_count}` : '✓'))
          : el('span', { title: 'Этикетка НЕ печаталась — не отгружайте до печати', style: { color: '#dc2626', fontWeight: '600', background: '#fee2e2', padding: '2px 6px', borderRadius: '4px' } }, '🚫 нет');
        // Подсвечиваем строку красным если без этикетки — сразу видно пропуски.
        if (!o.label_printed_at) rowEl.style.background = '#fef2f2';
        // Помечаем class для фильтра «не напечатано».
        if (!o.label_printed_at) rowEl.classList.add('ship-row-no-label');
        rowEl.append(
          el('td', {}, '#' + o.id),
          el('td', {}, o.marketplace || '—'),
          el('td', {}, o.client_name || '—'),
          el('td', {}, o.payment_method || '—'),
          el('td', {}, o.shipment_qr ? el('span', { title: o.shipment_qr }, '✓ есть') : (needQr ? el('span', { class: 'dev-down' }, '✗ нет!') : '—')),
          el('td', {}, printCell),
          el('td', {}, o.manager_name || '—'),
          el('td', {}, fmtDateTime(o.reserved_at)),
          el('td', {}, fmtMoney(o.total_amount, o.currency)),
        );
        if (canEdit) {
          rowEl.append(
            el('td', {},
              el('button', {
                class: 'btn btn-sm btn-danger',
                onClick: () => openCancelDialog(o.id, reload),
              }, '🚫 Отменить'),
            ),
          );
        }
        return rowEl;
      });
    }

    // Группировка по дате отгрузки. Прошедшие — свёрнутый блок сверху.
    const todayMsk = new Date(Date.now() + 3 * 3600000);
    todayMsk.setUTCHours(0, 0, 0, 0);
    const pastOrders = [];
    const futureGroups = new Map(); // dateStr → { dateMs, orders[] }
    const noDateOrders = [];
    for (const o of orders) {
      if (!o.shipping_date) {
        noDateOrders.push(o);
        continue;
      }
      const d = new Date(o.shipping_date);
      const dMsk = new Date(d.getTime() + 3 * 3600000);
      dMsk.setUTCHours(0, 0, 0, 0);
      if (dMsk.getTime() < todayMsk.getTime()) {
        pastOrders.push(o);
      } else {
        const key = dMsk.getTime();
        if (!futureGroups.has(key)) futureGroups.set(key, { dateMs: key, date: d, orders: [] });
        futureGroups.get(key).orders.push(o);
      }
    }
    const sortedGroups = [...futureGroups.values()].sort((a, b) => a.dateMs - b.dateMs);

    function makeGroupTable(list) {
      const clonedHead = headRow.cloneNode(true);
      // cloneNode не копирует event listeners — навешиваем заново на скопированный чекбокс
      if (canEdit) {
        const sa = clonedHead.querySelector('input[type="checkbox"]');
        if (sa) {
          sa.addEventListener('change', () => {
            sa.closest('table').querySelectorAll('.ship-row-cb').forEach((cb) => {
              cb.checked = sa.checked;
              const id = Number(cb.dataset.id);
              if (sa.checked) selected.add(id);
              else selected.delete(id);
            });
          });
        }
      }
      return el('div', { class: 'table-wrap' },
        el('table', { class: 'data' }, el('thead', {}, clonedHead), el('tbody', {}, ...makeRows(list))),
      );
    }

    // Кнопка переключения плоский/группированный список
    const toggleBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: 'auto' } },
      flatMode ? '📋 По датам' : '📄 Плоский список',
    );
    toggleBtn.addEventListener('click', () => {
      flatMode = !flatMode;
      localStorage.setItem(FLAT_KEY, flatMode ? '1' : '0');
      buildOrdersCard();
    });

    const titleRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '20px', marginBottom: '4px' } },
      el('h3', { style: { margin: '0', flex: '1' } }, `Заказы к отгрузке (${orders.length})`),
      toggleBtn,
    );

    const card = el('div', { class: 'card' });

    function buildOrdersCard() {
      card.replaceChildren(actions);
      toggleBtn.textContent = flatMode ? '📋 По датам' : '📄 Плоский список';

      if (flatMode) {
        // Плоский список, отсортированный по дате отгрузки (без даты — в конце)
        const sortedFlat = [...orders].sort((a, b) => {
          if (!a.shipping_date && !b.shipping_date) return 0;
          if (!a.shipping_date) return 1;
          if (!b.shipping_date) return -1;
          return new Date(a.shipping_date) - new Date(b.shipping_date);
        });
        card.append(makeGroupTable(sortedFlat));
        return;
      }

      if (pastOrders.length > 0) {
        const details = el('details', {});
        details.append(
          el('summary', { style: { cursor: 'pointer', padding: '8px 0', fontWeight: '600', color: 'var(--muted)' } },
            `Прошедшие даты (${pastOrders.length} заказов)`),
          makeGroupTable(pastOrders),
        );
        card.append(details);
      }

      for (const g of sortedGroups) {
        const label = new Intl.DateTimeFormat('ru-RU', {
          weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow',
        }).format(g.date);
        card.append(
          el('div', { style: { fontWeight: '600', padding: '12px 0 6px', borderTop: pastOrders.length || sortedGroups.indexOf(g) > 0 ? '1px solid var(--border)' : 'none' } },
            `${label} — ${g.orders.length} заказов`),
          makeGroupTable(g.orders),
        );
      }

      if (noDateOrders.length > 0) {
        card.append(
          el('div', { style: { fontWeight: '600', padding: '12px 0 6px', borderTop: '1px solid var(--border)' } },
            `Без даты отгрузки — ${noDateOrders.length} заказов`),
          makeGroupTable(noDateOrders),
        );
      }

      if (pastOrders.length === 0 && sortedGroups.length === 0 && noDateOrders.length === 0) {
        card.append(makeGroupTable(orders));
      }
    }

    buildOrdersCard();

    container.append(titleRow, card);
  }

  // Архив отгрузок (lazy — грузится при раскрытии)
  if (canEdit) {
    const archiveDetails = el('details', { style: { marginTop: '20px' } });
    const archiveSummary = el('summary', { style: { cursor: 'pointer', fontWeight: '600', fontSize: '16px', padding: '8px 0' } }, 'Архив отгрузок');
    const archiveBody = el('div');
    let archiveLoaded = false;
    // Диапазон дат отгрузки — по умолчанию не выбран (весь архив, последние 200).
    const archiveFromI = el('input', { type: 'date' });
    const archiveToI = el('input', { type: 'date' });
    let loadArchive = async () => {};
    archiveFromI.addEventListener('change', () => loadArchive());
    archiveToI.addEventListener('change', () => loadArchive());
    archiveDetails.addEventListener('toggle', async () => {
      if (!archiveDetails.open || archiveLoaded) return;
      archiveLoaded = true;
      await loadArchive();
    });
    loadArchive = async () => {
      archiveBody.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
      try {
        const dateParams = { shipped_from: archiveFromI.value, shipped_to: archiveToI.value };
        const r = await api.shippedArchive(dateParams);
        const shipped = r.data || [];
        if (!shipped.length) {
          archiveBody.replaceChildren(
            el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' } },
              el('label', {}, 'с ', archiveFromI), el('label', {}, 'по ', archiveToI)),
            el('div', { class: 'empty' }, 'Нет отгруженных заказов'),
          );
          return;
        }

        const archiveSelected = new Set();

        const archiveActions = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' } },
          el('label', {}, 'с ', archiveFromI), el('label', {}, 'по ', archiveToI),
          el('button', { class: 'btn', onClick: async () => {
            const ids = archiveSelected.size ? [...archiveSelected] : shipped.map((o) => o.id);
            if (!ids.length) { toast('Нет заказов для печати', 'error'); return; }
            try { await api.downloadLabelsPdf(ids); toast(`Этикетки сохранены (${ids.length} шт)`, 'success'); }
            catch (e2) { toast(e2.message || 'Не удалось сгенерировать PDF', 'error'); }
          } }, '🏷 Этикетки PDF'),
          el('button', { class: 'btn', onClick: async () => {
            // Выделены строки — выгружаем только их. Иначе — весь текущий (по фильтру дат) архив.
            const params = archiveSelected.size
              ? { ids: [...archiveSelected].join(',') }
              : { status: 'completed', shipped_from: archiveFromI.value, shipped_to: archiveToI.value };
            try { await api.downloadOrdersCsv(params); toast('Excel-файл сохранён', 'success'); }
            catch (e2) { toast(e2.message, 'error'); }
          } }, '⬇ Выгрузить в Excel'),
        );

        // Group by shipped_at date
        const groups = new Map();
        for (const o of shipped) {
          const d = o.shipped_at ? new Date(o.shipped_at) : null;
          const key = d ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(d) : 'Дата неизвестна';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(o);
        }

        const wrap = el('div');
        wrap.append(archiveActions);
        for (const [dateLabel, list] of groups) {
          const selectAll = el('input', { type: 'checkbox', title: 'Выбрать все в группе' });
          const tbl = el('table', { class: 'data' },
            el('thead', {}, el('tr', {},
              el('th', { style: { width: '36px' } }, selectAll),
              el('th', {}, '№'), el('th', {}, 'Площадка'), el('th', {}, 'Клиент'),
              el('th', {}, 'Трек-номер'), el('th', {}, 'Менеджер'), el('th', {}, 'Сумма'),
            )),
            el('tbody', {},
              ...list.map((o) => {
                const cb = el('input', { type: 'checkbox', class: 'archive-row-cb' });
                cb.dataset.id = String(o.id);
                cb.addEventListener('change', () => {
                  if (cb.checked) archiveSelected.add(o.id);
                  else archiveSelected.delete(o.id);
                });
                return el('tr', {
                  style: { cursor: 'pointer' },
                  onClick: async (e) => {
                    if (e.target.closest('button, input, a')) return;
                    try { const full = await api.get('orders', o.id); await showOrderDetails(full, () => {}); } catch (err) { toast(err.message, 'error'); }
                  },
                },
                  el('td', {}, cb),
                  el('td', {}, '#' + o.id),
                  el('td', {}, o.marketplace || '—'),
                  el('td', {}, o.client_name || '—'),
                  el('td', {}, o.shipment_qr || '—'),
                  el('td', {}, o.manager_name || '—'),
                  el('td', {}, fmtMoney(o.total_amount, o.currency)),
                );
              }),
            ),
          );
          selectAll.addEventListener('change', () => {
            tbl.querySelectorAll('.archive-row-cb').forEach((cb) => {
              cb.checked = selectAll.checked;
              const id = Number(cb.dataset.id);
              if (selectAll.checked) archiveSelected.add(id);
              else archiveSelected.delete(id);
            });
          });
          wrap.append(
            el('div', { style: { fontWeight: '600', padding: '10px 0 4px', borderTop: '1px solid var(--border)' } }, dateLabel),
            el('div', { class: 'table-wrap' }, tbl),
          );
        }
        archiveBody.replaceChildren(wrap);
      } catch (e) {
        archiveBody.replaceChildren(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
      }
    };
    archiveDetails.append(archiveSummary, archiveBody);
    container.append(archiveDetails);
  }
}

// ============ Обратная связь ============

const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: '🐛 Баг' },
  { value: 'question', label: '❓ Вопрос' },
  { value: 'suggestion', label: '💡 Предложение' },
  { value: 'other', label: '📝 Другое' },
];

// Виджет thread'а обсуждения обращения: список сообщений + поле ответа.
// Используется и в админ-карточке, и в «Моих обращениях». Авто-обновление по
// кнопке «🔄» (полл по таймеру слишком тяжело — лишний трафик при множестве вкладок).
function renderFeedbackThread(feedbackId, currentUserRole) {
  const list = el('div', { style: { maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', background: '#f9fafb', borderRadius: '6px', marginTop: '8px' } });
  const input = el('textarea', {
    rows: '2',
    placeholder: 'Напишите вопрос или ответ…',
    style: { width: '100%', resize: 'vertical' },
  });
  const sendBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Отправить');
  const refreshBtn = el('button', { class: 'btn btn-sm', title: 'Обновить' }, '🔄');

  // Вложения к ответу в треде.
  let pendingAttachments = [];
  const attachPreview = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' } });
  const fileInput = el('input', { type: 'file', accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt', multiple: true, style: { display: 'none' } });
  const attachBtn = el('button', { class: 'btn btn-sm', type: 'button', title: 'Прикрепить файл (макс. 2МБ, до 5 файлов)' }, '📎');

  function updateAttachPreview() {
    clear(attachPreview);
    pendingAttachments.forEach((att, idx) => {
      const tag = el('span', {
        style: { background: '#e0e7ff', borderRadius: '4px', padding: '2px 6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' },
      },
        att.filename,
        el('button', {
          type: 'button', style: { background: 'none', border: 'none', cursor: 'pointer', padding: '0', lineHeight: '1', color: '#374151' },
          onClick: () => { pendingAttachments.splice(idx, 1); updateAttachPreview(); },
        }, '×'),
      );
      attachPreview.append(tag);
    });
  }

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const file of files) {
      if (pendingAttachments.length >= 5) { toast('Максимум 5 вложений', 'error'); break; }
      if (file.size > 2 * 1024 * 1024) { toast(`${file.name}: файл больше 2 МБ`, 'error'); continue; }
      const content = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      pendingAttachments.push({ filename: file.name, type: file.type, size: file.size, content });
    }
    updateAttachPreview();
  });

  attachBtn.addEventListener('click', () => fileInput.click());

  function renderRow(m) {
    const isAdmin = m.role === 'admin';
    const atts = renderFeedbackAttachments(m.attachments);
    return el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: isAdmin ? 'flex-start' : 'flex-end',
        gap: '2px',
      },
    },
      el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } },
        `${isAdmin ? '🛠 Админ' : '👤 Автор'} · ${m.user_name || ''} · ${fmtDateTime(m.created_at)}`),
      el('div', {
        style: {
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: '10px',
          background: isAdmin ? '#dbeafe' : '#dcfce7',
          color: isAdmin ? '#1e3a8a' : '#14532d',
          whiteSpace: 'pre-wrap',
          fontSize: '14px',
          wordBreak: 'break-word',
        },
      }, m.text),
      ...(atts ? [atts] : []),
    );
  }

  async function reload() {
    clear(list);
    list.append(el('div', { class: 'hint', style: { textAlign: 'center' } }, 'Загрузка…'));
    try {
      const r = await api.feedbackMessages(feedbackId);
      clear(list);
      const rows = r.data || [];
      if (!rows.length) {
        list.append(el('div', { class: 'hint', style: { textAlign: 'center', padding: '8px' } },
          'Пока нет сообщений. Задайте вопрос или ответьте.'));
        return;
      }
      for (const m of rows) list.append(renderRow(m));
      list.scrollTop = list.scrollHeight;
    } catch (e) {
      clear(list);
      list.append(el('div', { class: 'error', style: { color: '#991b1b' } }, e.message || 'Ошибка'));
    }
  }

  sendBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { toast('Введите текст', 'error'); return; }
    sendBtn.disabled = true;
    try {
      await api.postFeedbackMessage(feedbackId, text, pendingAttachments.length ? pendingAttachments : null);
      input.value = '';
      pendingAttachments = [];
      updateAttachPreview();
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  });
  refreshBtn.addEventListener('click', reload);
  // Enter без Shift → отправка.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  const node = el('div', { style: { marginTop: '12px' } },
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
      el('b', {}, '💬 Обсуждение'),
      refreshBtn,
    ),
    list,
    el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'flex-end' } },
      input,
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        attachBtn,
        sendBtn,
      ),
    ),
    fileInput,
    attachPreview,
    el('div', { class: 'hint', style: { fontSize: '11px' } },
      currentUserRole === 'admin'
        ? 'Задайте уточняющий вопрос — автор получит уведомление и ответит здесь.'
        : 'Ответьте — админ увидит уведомление.'),
  );

  reload();
  return node;
}

// Превью вложений в карточке обращения у админа. Картинки кликабельны (открываются
// в новой вкладке), остальное — ссылка для скачивания. Скачивание через data URL
// работает напрямую — файлы маленькие (≤2МБ).
function renderFeedbackAttachments(rawAttachments) {
  if (!rawAttachments) return null;
  let list = rawAttachments;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return null; }
  }
  if (!Array.isArray(list) || !list.length) return null;
  return el('div', { style: { marginTop: '12px' } },
    el('h4', { style: { marginBottom: '6px' } }, `Вложения (${list.length})`),
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
      ...list.map((a) => {
        const isImg = (a.type || '').startsWith('image/');
        if (isImg) {
          return el('a', { href: a.content, target: '_blank', rel: 'noopener', title: a.filename },
            el('img', { src: a.content, style: { width: '120px', height: '120px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' } }),
          );
        }
        return el('a', {
          href: a.content,
          download: a.filename,
          style: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: '#f9fafb', border: '1px solid var(--border)', borderRadius: '6px', textDecoration: 'none', color: 'inherit' },
        },
          el('span', { style: { fontSize: '20px' } }, '📎'),
          el('span', {},
            el('div', { style: { fontSize: '13px' } }, a.filename),
            a.size ? el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, `${(a.size / 1024).toFixed(0)} КБ`) : null,
          ),
        );
      }),
    ),
  );
}

// Лимиты согласованы с backend (см. src/routes/feedback.js).
const FEEDBACK_MAX_FILE = 2 * 1024 * 1024;
const FEEDBACK_MAX_FILES = 5;

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes) {
  if (!bytes) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export async function openFeedbackDialog() {
  const catSel = el('select', {},
    ...FEEDBACK_CATEGORIES.map((c) => el('option', { value: c.value }, c.label)),
  );
  const subjectI = el('input', { type: 'text', placeholder: 'Кратко суть' });
  const messageI = el('textarea', { rows: '6', placeholder: 'Опишите подробно: что произошло, что ожидали, шаги воспроизведения' });

  // Список выбранных файлов (data URLs). При сабмите идут в body.attachments.
  const attachments = [];
  const filesList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' } });

  function renderFilesList() {
    clear(filesList);
    if (!attachments.length) return;
    for (const [idx, a] of attachments.entries()) {
      const isImg = (a.type || '').startsWith('image/');
      filesList.append(el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#f9fafb', border: '1px solid var(--border)', borderRadius: '6px' },
      },
        isImg ? el('img', { src: a.content, style: { width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' } }) : el('span', { style: { fontSize: '24px' } }, '📎'),
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.filename),
          el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, humanSize(a.size || 0)),
        ),
        el('button', {
          class: 'btn btn-xs',
          type: 'button',
          title: 'Удалить',
          onClick: () => { attachments.splice(idx, 1); renderFilesList(); },
        }, '✕'),
      ));
    }
  }

  const fileI = el('input', {
    type: 'file',
    multiple: true,
    accept: 'image/*,application/pdf,.txt,.log,.json,.csv',
    style: { display: 'none' },
  });
  fileI.addEventListener('change', async () => {
    const picked = Array.from(fileI.files || []);
    fileI.value = ''; // позволяет выбрать тот же файл повторно после удаления
    for (const f of picked) {
      if (attachments.length >= FEEDBACK_MAX_FILES) {
        toast(`Не больше ${FEEDBACK_MAX_FILES} файлов`, 'error');
        break;
      }
      if (f.size > FEEDBACK_MAX_FILE) {
        toast(`«${f.name}» слишком большой (макс ${humanSize(FEEDBACK_MAX_FILE)})`, 'error');
        continue;
      }
      try {
        const content = await readFileAsDataURL(f);
        attachments.push({ filename: f.name, type: f.type || null, size: f.size || 0, content });
      } catch (e) {
        toast(`«${f.name}»: ${e.message}`, 'error');
      }
    }
    renderFilesList();
  });

  const pickBtn = el('button', {
    class: 'btn btn-sm',
    type: 'button',
    onClick: () => fileI.click(),
  }, '📎 Прикрепить файл');

  const body = el('div', {},
    el('p', { style: { color: 'var(--text-muted)', fontSize: '13px' } },
      'Сообщения видит администратор. Опишите проблему или задайте вопрос — мы постараемся быстро ответить.'),
    el('div', { class: 'form-row' }, el('label', {}, 'Категория'), catSel),
    el('div', { class: 'form-row' }, el('label', {}, 'Тема *'), subjectI),
    el('div', { class: 'form-row' }, el('label', {}, 'Сообщение *'), messageI),
    el('div', { class: 'form-row' },
      el('label', {}, 'Файлы'),
      el('div', {},
        pickBtn,
        fileI,
        el('div', { class: 'hint', style: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' } },
          `Скриншоты, PDF, текстовые логи. До ${FEEDBACK_MAX_FILES} файлов × ${humanSize(FEEDBACK_MAX_FILE)}.`),
        filesList,
      ),
    ),
  );
  await openModal('📮 Обратная связь', body, {
    primaryLabel: 'Отправить',
    onSubmit: async () => {
      const subject = subjectI.value.trim();
      const message = messageI.value.trim();
      if (!subject) { toast('Заполните тему', 'error'); return false; }
      if (!message) { toast('Заполните сообщение', 'error'); return false; }
      try {
        await api.submitFeedback({
          category: catSel.value,
          subject,
          message,
          context: `${location.hash || '#/'} · ${navigator.userAgent.slice(0, 200)}`,
          attachments: attachments.length ? attachments : undefined,
        });
        toast('Спасибо! Сообщение отправлено администратору.', 'success');
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

export async function renderFeedback(main, opts = {}) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') {
    main.innerHTML = '';
    main.append(el('div', { class: 'card' }, 'Раздел доступен только администратору.'));
    return;
  }

  const state = { status: '', page: 1 };
  const tableArea = el('div');

  async function reload() {
    const r = await api.listFeedback({ status: state.status, page: String(state.page), limit: '50' });
    renderTable(r);
  }

  function statusBadge(s) {
    const map = {
      open: ['Открыто', '#fef3c7', '#92400e'],
      in_progress: ['В работе', '#dbeafe', '#1e40af'],
      awaiting_approval: ['Ждёт подтверждения автора', '#fed7aa', '#9a3412'],
      closed: ['Закрыто', '#dcfce7', '#166534'],
    };
    const [label, bg, fg] = map[s] || [s, '#eee', '#444'];
    return el('span', { style: { background: bg, color: fg, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 } }, label);
  }

  function categoryLabel(c) {
    return (FEEDBACK_CATEGORIES.find((x) => x.value === c) || { label: c }).label;
  }

  async function openItem(item) {
    const replyI = el('textarea', { rows: '4', placeholder: 'Заметка / ответ (видна только админу)', style: { width: '100%' } });
    if (item.admin_reply) replyI.value = item.admin_reply;
    const statusSel = el('select', {},
      el('option', { value: 'open', selected: item.status === 'open' }, 'Открыто'),
      el('option', { value: 'in_progress', selected: item.status === 'in_progress' }, 'В работе'),
      el('option', { value: 'awaiting_approval', selected: item.status === 'awaiting_approval' }, 'На подтверждение автору'),
      el('option', { value: 'closed', selected: item.status === 'closed' }, 'Закрыто (без подтверждения)'),
    );
    const body = el('div', {},
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Тема'), el('div', {}, el('b', {}, item.subject)),
        el('div', { class: 'k' }, 'Категория'), el('div', {}, categoryLabel(item.category)),
        el('div', { class: 'k' }, 'От'), el('div', {}, `${item.user_name || '—'} (${item.user_email || '—'}, ${item.user_role || '—'})`),
        el('div', { class: 'k' }, 'Когда'), el('div', {}, fmtDateTime(item.created_at)),
        el('div', { class: 'k' }, 'Контекст'), el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all' } }, item.context || '—'),
      ),
      el('h4', { style: { marginTop: '16px' } }, 'Сообщение'),
      el('pre', { style: { background: '#f9fafb', padding: '10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'inherit' } }, item.message),
      renderFeedbackAttachments(item.attachments),
      item.rejected_reason ? el('div', {
        style: { background: '#fef2f2', border: '1px solid #fecaca', padding: '10px', borderRadius: '6px', marginTop: '12px' },
      },
        el('b', {}, '⚠️ Автор вернул в работу: '),
        item.rejected_reason,
      ) : null,
      el('div', { class: 'form-row' }, el('label', {}, 'Статус'), statusSel),
      el('div', { class: 'hint', style: { color: '#0369a1' } },
        'Переведи на «На подтверждение автору», когда задача выполнена — автор увидит уведомление и нажмёт «Принимаю» либо вернёт в работу.'),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметка / ответ'), replyI),
      renderFeedbackThread(item.id, 'admin'),
    );
    await openModal(`Обращение #${item.id}`, body, {
      primaryLabel: 'Сохранить',
      onSubmit: async () => {
        try {
          await api.updateFeedback(item.id, { status: statusSel.value, admin_reply: replyI.value });
          toast('Сохранено', 'success');
          await reload();
        } catch (e) { toast(e.message, 'error'); return false; }
      },
    });
  }

  function renderTable(r) {
    clear(tableArea);
    const rows = r.data || [];
    if (rows.length === 0) {
      tableArea.append(emptyState({
        icon: '📮',
        title: state.status ? 'В этом фильтре пусто' : 'Обращений пока нет',
        description: state.status
          ? 'Снимите фильтр или подождите новых обращений.'
          : 'Как только кто-то отправит сообщение через кнопку «📮 Помощь / Баг» в сайдбаре — оно появится здесь.',
      }));
      return;
    }
    const headRow = el('tr', {},
      el('th', {}, '№'),
      el('th', {}, 'Статус'),
      el('th', {}, 'Категория'),
      el('th', {}, 'Тема'),
      el('th', {}, 'От'),
      el('th', {}, 'Когда'),
    );
    const tbody = el('tbody', {},
      ...rows.map((it) => {
        // attachments может прийти как JSON-строка или уже массив (pg возвращает объект).
        let atts = it.attachments;
        if (typeof atts === 'string') {
          try { atts = JSON.parse(atts); } catch { atts = null; }
        }
        const attCount = Array.isArray(atts) ? atts.length : 0;
        return el('tr', {
          style: { cursor: 'pointer' },
          onClick: () => openItem({ ...it, attachments: atts }),
        },
          el('td', {}, '#' + it.id),
          el('td', {}, statusBadge(it.status)),
          el('td', {}, categoryLabel(it.category)),
          el('td', {}, it.subject, attCount ? el('span', { style: { marginLeft: '6px', fontSize: '12px', color: 'var(--text-muted)' } }, `📎${attCount}`) : null),
          el('td', {}, `${it.user_name || '—'} (${it.user_role || '—'})`),
          el('td', {}, fmtDateTime(it.created_at)),
        );
      }),
    );
    tableArea.append(el('div', { class: 'card' },
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, headRow), tbody)),
    ));
  }

  const filterSel = el('select', {},
    el('option', { value: '', selected: !state.status }, 'Все'),
    el('option', { value: 'open' }, 'Открытые'),
    el('option', { value: 'in_progress' }, 'В работе'),
    el('option', { value: 'awaiting_approval' }, 'Ждут подтверждения'),
    el('option', { value: 'closed' }, 'Закрытые'),
  );
  filterSel.addEventListener('change', () => { state.status = filterSel.value; state.page = 1; reload(); });

  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, 'Обращения'),
    el('div', { class: 'page-subtitle' }, 'Вопросы и баги от менеджеров, склада и других пользователей.'),
    el('div', { class: 'filter-bar', style: { marginBottom: '12px' } },
      el('label', {}, 'Статус: ', filterSel),
    ),
    tableArea,
  );
  await reload();

  // Глубокая ссылка из уведомления: «#/feedback?id=42» — открываем тред.
  const initialId = Number(opts.params?.get('id'));
  if (initialId) {
    api.getFeedback(initialId).then((item) => {
      if (item) openItem(item);
    }).catch(() => {});
  }
}

// Страница «Мои обращения» — для всех ролей. Показывает свои обращения и для
// каждой записи в статусе «awaiting_approval» — карточку с «Принимаю / Не принимаю».
export async function renderMyFeedback(main, opts = {}) {
  const tableArea = el('div');

  function statusBadge(s) {
    const map = {
      open: ['Открыто', '#fef3c7', '#92400e'],
      in_progress: ['В работе', '#dbeafe', '#1e40af'],
      awaiting_approval: ['Подтвердите', '#fed7aa', '#9a3412'],
      closed: ['Закрыто', '#dcfce7', '#166534'],
    };
    const [label, bg, fg] = map[s] || [s, '#eee', '#444'];
    return el('span', { style: { background: bg, color: fg, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 } }, label);
  }
  function catLabel(c) {
    return (FEEDBACK_CATEGORIES.find((x) => x.value === c) || { label: c }).label;
  }

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.myFeedback();
      renderList(r.data || []);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message || 'Ошибка'));
    }
  }

  function renderList(rows) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({
        icon: '📋',
        title: 'У вас пока нет обращений',
        description: 'Нажмите «📮 Помощь / Баг» в сайдбаре, чтобы отправить вопрос или сообщить о проблеме.',
      }));
      return;
    }

    // Сначала большие карточки для «требует подтверждения», потом таблица остальных.
    const awaiting = rows.filter((r) => r.status === 'awaiting_approval');
    const others = rows.filter((r) => r.status !== 'awaiting_approval');

    if (awaiting.length) {
      tableArea.append(el('h3', { style: { color: '#9a3412', marginTop: 0 } }, '⏳ Требуют вашего подтверждения'));
      for (const item of awaiting) {
        tableArea.append(buildApprovalCard(item));
      }
    }

    if (others.length) {
      tableArea.append(el('h3', { style: { marginTop: awaiting.length ? '24px' : '0' } }, 'Остальные обращения'));
      const rowsEl = others.map((it) => el('tr', {
        style: { cursor: 'pointer' },
        onClick: () => openDetail(it),
      },
        el('td', {}, '#' + it.id),
        el('td', {}, statusBadge(it.status)),
        el('td', {}, catLabel(it.category)),
        el('td', {}, it.subject),
        el('td', {}, fmtDateTime(it.created_at)),
        // Явная кнопка — клик по строке тоже работает, но не у всех это очевидно.
        el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
          el('button', {
            class: 'btn btn-sm btn-primary',
            onClick: () => openDetail(it),
          }, '💬 Открыть'),
        ),
      ));
      tableArea.append(el('div', { class: 'card' },
        el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
          el('thead', {}, el('tr', {},
            el('th', {}, '№'), el('th', {}, 'Статус'),
            el('th', {}, 'Категория'), el('th', {}, 'Тема'), el('th', {}, 'Когда'),
            el('th', { style: { textAlign: 'right' } }, ''))),
          el('tbody', {}, ...rowsEl),
        )),
      ));
    }
  }

  function buildApprovalCard(item) {
    const card = el('div', {
      class: 'card',
      style: { border: '2px solid #fb923c', background: '#fff7ed', marginBottom: '12px' },
    });
    card.append(
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' } },
        el('div', {},
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, `#${item.id} · ${catLabel(item.category)}`),
          el('div', { style: { fontSize: '17px', fontWeight: 600, marginTop: '4px' } }, item.subject),
        ),
        el('div', {}, statusBadge(item.status)),
      ),
      el('div', { style: { marginTop: '12px' } },
        el('div', { style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' } }, 'Ваше обращение:'),
        el('pre', { style: { background: '#fff', padding: '8px 10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'inherit', margin: 0 } }, item.message),
      ),
      item.admin_reply ? el('div', { style: { marginTop: '12px' } },
        el('div', { style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' } }, 'Ответ исполнителя:'),
        el('pre', { style: { background: '#f0f9ff', padding: '8px 10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'inherit', margin: 0, border: '1px solid #bae6fd' } }, item.admin_reply),
      ) : null,
      el('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            if (!(await confirm('Подтвердить выполнение? Обращение перейдёт в «Закрыто».'))) return;
            try {
              await api.approveFeedback(item.id);
              toast('Спасибо, обращение закрыто', 'success');
              await reload();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, '✅ Принимаю — выполнено'),
        el('button', {
          class: 'btn btn-danger',
          onClick: async () => {
            const reason = prompt('Что не так? Опишите, почему не принимаете:');
            if (!reason || !reason.trim()) return;
            try {
              await api.rejectFeedback(item.id, reason.trim());
              toast('Возвращено в работу. Админ получил уведомление.', '');
              await reload();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, '↩️ Не принято — вернуть в работу'),
        el('button', {
          class: 'btn',
          onClick: () => openDetail(item),
        }, '💬 Открыть переписку в окне'),
      ),
      el('details', { style: { marginTop: '12px' }, open: true },
        el('summary', { style: { cursor: 'pointer', fontWeight: 600, color: '#0369a1' } }, '💬 Переписка по обращению'),
        renderFeedbackThread(item.id, 'author'),
      ),
    );
    return card;
  }

  async function openDetail(item) {
    const body = el('div', {},
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Тема'), el('div', {}, el('b', {}, item.subject)),
        el('div', { class: 'k' }, 'Категория'), el('div', {}, catLabel(item.category)),
        el('div', { class: 'k' }, 'Статус'), el('div', {}, statusBadge(item.status)),
        el('div', { class: 'k' }, 'Создано'), el('div', {}, fmtDateTime(item.created_at)),
        item.resolved_at ? el('div', { class: 'k' }, 'Решено') : null,
        item.resolved_at ? el('div', {}, fmtDateTime(item.resolved_at)) : null,
      ),
      el('h4', { style: { marginTop: '16px' } }, 'Сообщение'),
      el('pre', { style: { background: '#f9fafb', padding: '10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'inherit' } }, item.message),
      item.admin_reply ? el('div', {},
        el('h4', { style: { marginTop: '16px' } }, 'Ответ исполнителя'),
        el('pre', { style: { background: '#f0f9ff', padding: '10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '13px', fontFamily: 'inherit' } }, item.admin_reply),
      ) : null,
      item.rejected_reason ? el('div', { style: { marginTop: '12px', padding: '10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px' } },
        el('b', {}, 'Возвращено в работу: '), item.rejected_reason,
      ) : null,
      renderFeedbackThread(item.id, 'author'),
    );
    await openModal(`Обращение #${item.id}`, body, { primaryLabel: 'Закрыть', onSubmit: () => true });
  }

  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '📋 Мои обращения'),
    el('div', { class: 'page-subtitle' }, 'Здесь видны ваши обращения через «📮 Помощь / Баг». Когда задача выполнена — подтвердите приёмку или верните в работу.'),
    tableArea,
  );
  await reload();

  // Глубокая ссылка из уведомления: «#/my-feedback?id=42» — открываем тред.
  const initialId = Number(opts.params?.get('id'));
  if (initialId) {
    api.getFeedback(initialId).then((item) => {
      if (item) openDetail(item);
    }).catch(() => {});
  }
}

// Аудит-лог: кто и что делал. Только админ. Фильтры по типу сущности / префиксу действия
// / пользователю; пагинация. Детали в виде JSON открываются по клику на строку.
export async function renderAudit(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') {
    main.innerHTML = '';
    main.append(el('div', { class: 'card' }, 'Раздел доступен только администратору.'));
    return;
  }

  const PAGE = 100;
  const state = { entity_type: '', action: '', user_id: '', offset: 0, total: 0 };
  const tableArea = el('div');

  const ACTION_LABELS = {
    'order.created': '🆕 Создан заказ',
    'order.updated': '✏️ Заказ изменён',
    'order.reserved': '📦 Резерв',
    'order.unreserved': '↩️ Снят резерв',
    'order.shipped': '🚚 Отгрузка',
    'order.unshipped': '↩️ Откат отгрузки',
    'order.completed': '✅ Завершён',
    'order.cancelled': '❌ Отменён',
    'order.mark_waiting': '⏳ Ожидает товара',
    'order.mark_ready': '✓ Готов',
    'order.return_resolved': '↩ Возврат обработан',
    'order.loss_voided': '🗑 Потеря аннулирована',
    'order.split': '✂ Разделён',
    'order.item_cancelled': '✂❌ Позиция отменена',
    'order.item_waiting': '✂⏳ Позиция в ожидание',
    'order.deleted': '🗑 Удалён',
    'payment.created': '💰 Платёж создан',
    'payment.updated': '✏️ Платёж изменён',
    'payment.confirmed': '✅ Платёж подтверждён',
    'payment.rejected': '❌ Платёж отклонён',
    'payment.deleted': '🗑 Платёж удалён',
    'user.created': '👤 Пользователь создан',
    'user.updated': '✏️ Пользователь изменён',
    'user.password_changed': '🔑 Пароль изменён',
    'user.deleted': '🗑 Пользователь удалён',
    'auth.login': '🔓 Вход',
    'auth.login_failed': '⛔ Неуд. вход',
    'auth.impersonate': '👁 Имперсонация',
  };

  function actionLabel(a) {
    return ACTION_LABELS[a] || a;
  }

  function entityLink(row) {
    if (!row.entity_type || !row.entity_id) return el('span', { class: 'muted' }, '—');
    if (row.entity_type === 'order') {
      return el('a', { href: `#/orders?id=${row.entity_id}` }, `Заказ #${row.entity_id}`);
    }
    if (row.entity_type === 'user') {
      return el('a', { href: `#/users` }, `Пользователь #${row.entity_id}`);
    }
    if (row.entity_type === 'payment') {
      return el('a', { href: `#/cashbox` }, `Платёж #${row.entity_id}`);
    }
    return el('span', {}, `${row.entity_type} #${row.entity_id}`);
  }

  function formatDetails(d) {
    if (!d) return '';
    try {
      const obj = typeof d === 'string' ? JSON.parse(d) : d;
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(d);
    }
  }

  async function openDetails(row) {
    const body = el('div', {},
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Действие'), el('div', {}, actionLabel(row.action), ' ', el('code', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, row.action)),
        el('div', { class: 'k' }, 'Кто'), el('div', {}, `${row.user_name || '—'} (${tr('role', row.user_role) || row.user_role || '—'})`),
        el('div', { class: 'k' }, 'Объект'), el('div', {}, entityLink(row)),
        el('div', { class: 'k' }, 'Когда'), el('div', {}, fmtDateTime(row.created_at)),
        el('div', { class: 'k' }, 'IP'), el('div', {}, row.ip || '—'),
      ),
      row.details ? el('h4', { style: { marginTop: '16px' } }, 'Детали') : null,
      row.details ? el('pre', { style: { background: '#f9fafb', padding: '10px', borderRadius: '6px', whiteSpace: 'pre-wrap', fontSize: '12px' } }, formatDetails(row.details)) : null,
    );
    await openModal(`Запись #${row.id}`, body, { primaryLabel: 'Закрыть', onSubmit: () => true });
  }

  function renderTable(r) {
    clear(tableArea);
    const rows = r.data || [];
    state.total = r.total || 0;
    if (rows.length === 0) {
      tableArea.append(emptyState({
        icon: '📜',
        title: 'Записей не найдено',
        description: 'Попробуйте сменить фильтры или подождите новых действий.',
      }));
      return;
    }
    const headRow = el('tr', {},
      el('th', {}, 'Когда'),
      el('th', {}, 'Кто'),
      el('th', {}, 'Действие'),
      el('th', {}, 'Объект'),
      el('th', {}, 'IP'),
    );
    const tbody = el('tbody', {},
      ...rows.map((it) => el('tr', {
        style: { cursor: 'pointer' },
        onClick: () => openDetails(it),
      },
        el('td', { 'data-label': 'Когда' }, fmtDateTime(it.created_at)),
        el('td', { 'data-label': 'Кто' }, `${it.user_name || '—'} (${tr('role', it.user_role) || it.user_role || '—'})`),
        el('td', { 'data-label': 'Действие' }, actionLabel(it.action)),
        el('td', { 'data-label': 'Объект' }, entityLink(it)),
        el('td', { 'data-label': 'IP' }, it.ip || '—'),
      )),
    );
    const pageInfo = el('div', { class: 'page-info', style: { marginTop: '12px' } },
      `Показано ${state.offset + 1}–${state.offset + rows.length} из ${state.total}`);
    const prev = el('button', {
      class: 'btn btn-sm',
      disabled: state.offset <= 0 ? true : false,
      onClick: () => { state.offset = Math.max(0, state.offset - PAGE); reload(); },
    }, '‹ Назад');
    const next = el('button', {
      class: 'btn btn-sm',
      disabled: state.offset + rows.length >= state.total ? true : false,
      onClick: () => { state.offset += PAGE; reload(); },
    }, 'Вперёд ›');
    tableArea.append(el('div', { class: 'card' },
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, headRow), tbody)),
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' } },
        pageInfo, el('div', {}, prev, ' ', next),
      ),
    ));
  }

  async function reload() {
    const q = { limit: String(PAGE), offset: String(state.offset) };
    if (state.entity_type) q.entity_type = state.entity_type;
    if (state.action) q.action = state.action;
    if (state.user_id) q.user_id = state.user_id;
    try {
      const r = await api.listAudit(q);
      renderTable(r);
    } catch (e) {
      tableArea.innerHTML = '';
      tableArea.append(el('div', { class: 'card error' }, e.message || 'Ошибка загрузки'));
    }
  }

  const entitySel = el('select', {},
    el('option', { value: '' }, 'Все объекты'),
    el('option', { value: 'order' }, 'Заказы'),
    el('option', { value: 'payment' }, 'Платежи'),
    el('option', { value: 'user' }, 'Пользователи'),
  );
  entitySel.addEventListener('change', () => { state.entity_type = entitySel.value; state.offset = 0; reload(); });

  const actionInp = el('input', { type: 'text', placeholder: 'order.shipped, auth.', style: { width: '180px' } });
  actionInp.addEventListener('change', () => { state.action = actionInp.value.trim(); state.offset = 0; reload(); });

  const userInp = el('input', { type: 'number', placeholder: 'ID', style: { width: '90px' } });
  userInp.addEventListener('change', () => { state.user_id = userInp.value.trim(); state.offset = 0; reload(); });

  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, 'История действий'),
    el('div', { class: 'page-subtitle' }, 'Кто и что делал с заказами, платежами и пользователями. Записи нельзя редактировать или удалять.'),
    el('div', { class: 'filter-bar', style: { marginBottom: '12px' } },
      el('label', {}, 'Объект: ', entitySel),
      el('label', {}, 'Действие: ', actionInp),
      el('label', {}, 'Пользователь: ', userInp),
    ),
    tableArea,
  );
  await reload();
}

// === МАХ-бот: привязка чата пользователя ===
// Открывается из сайдбара кнопкой «🔔 Подключить МАХ». Шаги:
//   1) Кликаем «Получить код» — бэк генерит 6-значный код, кладёт в users.max_bind_code.
//   2) Пользователь в МАХ открывает бота (имя/ссылка показаны в модалке) и шлёт /start <код>.
//   3) Webhook ловит → save chat_id → бот пишет «Подключено».
//   4) В модалке кнопка «Проверить» поллит /api/max/me — если bound, поздравляем.
export async function openMaxBindDialog() {
  const statusBlock = el('div', { class: 'detail-grid', style: { marginBottom: '12px' } });
  const codeBlock = el('div');
  const checkBtn = el('button', { class: 'btn btn-sm' }, '🔄 Проверить статус');
  const unbindBtn = el('button', { class: 'btn btn-sm btn-danger' }, 'Отвязать');

  async function refresh() {
    const me = await api.maxMe().catch(() => ({ bound: false }));
    clear(statusBlock);
    statusBlock.append(
      el('div', { class: 'k' }, 'Статус'),
      el('div', {}, me.bound
        ? el('span', { style: { color: 'green', fontWeight: 600 } }, '✅ Подключено — уведомления приходят в МАХ')
        : el('span', { style: { color: 'var(--text-muted)' } }, '⚪ Не подключено')),
    );
    clear(codeBlock);
    if (me.bound) {
      codeBlock.append(
        el('p', {}, 'Если хотите отключить уведомления в МАХ — нажмите кнопку ниже.'),
        unbindBtn,
      );
    } else {
      codeBlock.append(
        el('p', { style: { color: 'var(--text-muted)' } },
          'Чтобы получать уведомления в мессенджере МАХ, нажмите «Получить код» и пришлите его боту.'),
        el('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            try {
              const r = await api.maxBindCode();
              clear(codeBlock);
              // Большая основная кнопка-ссылка на бота с подставленным /start <код>.
              // Если МАХ deep-link поддерживает start-param — команда подставится
              // автоматически. Если нет — пользователь скопирует код из карточки.
              const openBotBtn = r.deep_link ? el('a', {
                href: r.deep_link, target: '_blank', rel: 'noopener',
                class: 'btn btn-primary',
                style: { display: 'block', textAlign: 'center', padding: '12px', fontSize: '16px', marginBottom: '12px' },
              }, `💬 Открыть бота${r.bot_username ? ' @' + r.bot_username : ''} в МАХ`) : null;

              // Кнопка копирования всей команды /start <код>.
              const copyCmdBtn = el('button', {
                class: 'btn btn-sm',
                style: { width: '100%', marginTop: '8px' },
                onClick: async () => {
                  try {
                    await navigator.clipboard.writeText(`/start ${r.code}`);
                    toast('Команда скопирована', 'success');
                  } catch { toast('Не удалось скопировать', 'error'); }
                },
              }, `📋 Скопировать «/start ${r.code}»`);

              codeBlock.append(
                openBotBtn,
                el('div', { class: 'card', style: { padding: '14px', textAlign: 'center', marginBottom: '8px', background: '#f9fafb' } },
                  el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, 'Если автоматически не вставилось, ваш код:'),
                  el('div', { style: { fontSize: '32px', fontWeight: 700, letterSpacing: '4px', margin: '6px 0', fontFamily: 'monospace' } }, r.code),
                  copyCmdBtn,
                  el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' } }, `Действует ${r.expires_in_minutes || 30} минут`),
                ),
                el('div', { class: 'hint', style: { marginBottom: '8px' } },
                  '1) Нажмите большую кнопку выше — откроется чат с ботом в МАХ. ' +
                  '2) Если команда подставилась — просто отправьте её. ' +
                  '3) Если нет — отправьте боту скопированную команду. ' +
                  '4) Вернитесь и нажмите «🔄 Проверить статус».'),
                checkBtn,
              );
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'Получить код'),
      );
    }
  }

  checkBtn.addEventListener('click', async () => {
    await refresh();
    const me = await api.maxMe().catch(() => null);
    if (me?.bound) toast('Подключено! Уведомления будут приходить в МАХ.', 'success');
    else toast('Пока не подключено. Отправили боту /start КОД?', '');
  });

  unbindBtn.addEventListener('click', async () => {
    if (!(await confirm('Отвязать МАХ? Уведомления в мессенджере перестанут приходить.'))) return;
    try {
      await api.maxUnbind();
      toast('МАХ отвязан', 'success');
      await refresh();
    } catch (e) { toast(e.message, 'error'); }
  });

  const body = el('div', {}, statusBlock, codeBlock);
  await refresh();
  await openModal('🔔 Уведомления в МАХ', body, { primaryLabel: 'Закрыть', onSubmit: () => true });
}

// Админ-секция МАХ-бота в «Настройках».
export async function renderMaxBotSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') return;
  area.append(el('div', { class: 'section-header' }, el('h2', {}, '🔔 МАХ-бот (уведомления в мессенджер)')));
  area.append(el('p', { class: 'help-banner' },
    'Бот шлёт пользователям те же уведомления, что показывает колокольчик. ',
    'Сначала создайте бота на dev.max.ru, скопируйте Bearer-токен, сохраните здесь. ',
    'Затем зарегистрируйте webhook (один раз) — после этого пользователи смогут привязать свой МАХ-аккаунт через профиль.',
  ));

  const status = await api.maxAdminStatus().catch((e) => ({ error: e.message }));
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен МАХ-бота' });

  const tokenRow = el('div', { class: 'form-row' },
    el('label', {}, 'Токен бота'),
    tokenI,
    el('button', {
      class: 'btn btn-sm btn-primary',
      onClick: async () => {
        const tok = tokenI.value.trim();
        if (!tok) return toast('Введите токен', 'error');
        try { await api.maxAdminSetToken(tok); toast('Токен сохранён', 'success'); await renderMaxBotSection(area); }
        catch (e) { toast(e.message, 'error'); }
      },
    }, 'Сохранить'),
    status?.has_token ? el('button', {
      class: 'btn btn-sm btn-danger',
      onClick: async () => {
        if (!(await confirm('Удалить токен? Все привязки сохранятся, но уведомления перестанут уходить.'))) return;
        try { await api.maxAdminSetToken(null); toast('Токен удалён', 'success'); await renderMaxBotSection(area); }
        catch (e) { toast(e.message, 'error'); }
      },
    }, 'Удалить') : null,
  );

  const defaultWebhook = `${location.origin}/api/max/webhook`;
  const webhookI = el('input', { type: 'text', placeholder: defaultWebhook, value: status?.webhook_url || defaultWebhook });
  const webhookRow = el('div', { class: 'form-row' },
    el('label', {}, 'Webhook URL'),
    webhookI,
    el('button', {
      class: 'btn btn-sm btn-primary',
      onClick: async () => {
        const url = webhookI.value.trim();
        if (!url) return toast('Введите URL', 'error');
        try { await api.maxAdminSetWebhook(url); toast('Webhook зарегистрирован у МАХ', 'success'); await renderMaxBotSection(area); }
        catch (e) { toast(e.message, 'error'); }
      },
    }, 'Зарегистрировать'),
  );

  const statusBlock = el('div', { class: 'detail-grid', style: { marginTop: '8px' } },
    el('div', { class: 'k' }, 'Токен'),
    el('div', {}, status?.has_token ? '✅ задан' : '⚪ не задан'),
    el('div', { class: 'k' }, 'Webhook'),
    el('div', {}, status?.webhook_url || '⚪ не зарегистрирован'),
    el('div', { class: 'k' }, 'Имя бота'),
    el('div', {}, status?.bot?.username ? `@${status.bot.username}` : (status?.bot?.error ? `Ошибка: ${status.bot.error}` : '—')),
    el('div', { class: 'k' }, 'Привязано пользователей'),
    el('div', {}, String(status?.bound_users || 0)),
  );

  const testBtn = el('button', { class: 'btn btn-sm' }, '✉️ Тестовая отправка себе');
  testBtn.addEventListener('click', async () => {
    try { await api.maxAdminTest(); toast('Отправлено! Проверьте МАХ.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  });

  // Кнопка диагностики — пробует /me и /subscriptions у МАХ, показывает raw-ответы.
  const diagBtn = el('button', { class: 'btn btn-sm' }, '🔬 Диагностика API');
  diagBtn.addEventListener('click', async () => {
    diagBtn.disabled = true;
    diagBtn.textContent = '⏳ Проверяю…';
    try {
      const r = await api.maxAdminDiagnose();
      const body = el('div', {},
        el('div', { style: { marginBottom: '8px' } }, el('b', {}, 'Base URL: '), r.base || '—'),
        ...((r.tests || []).map((t) => el('div', {
          style: { marginBottom: '8px', padding: '8px', background: '#f9fafb', borderRadius: '6px' },
        },
          el('div', { style: { fontWeight: 600, marginBottom: '4px' } }, t.name),
          el('div', { class: 'muted', style: { fontSize: '12px', wordBreak: 'break-all' } }, t.url),
          t.error
            ? el('div', { style: { color: '#991b1b', marginTop: '4px' } }, '❌ ' + t.error)
            : el('div', { style: { marginTop: '4px' } },
                el('b', {}, `${t.status} ${t.ok ? '✅' : '❌'}`),
                el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', margin: '4px 0 0', maxHeight: '200px', overflowY: 'auto' } }, t.body || '(пусто)'),
              ),
        ))),
      );
      await openModal('🔬 Диагностика MAX API', body, { primaryLabel: 'Закрыть', onSubmit: () => true });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      diagBtn.disabled = false;
      diagBtn.textContent = '🔬 Диагностика API';
    }
  });

  area.append(tokenRow, webhookRow, statusBlock,
    el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, testBtn, diagBtn));

  // Справочник всех типов уведомлений с шаблонами — что вообще можно слать в МАХ.
  // Юзеры сами выбирают что получать в «👤 Мой профиль» → «Что получать в МАХ».
  try {
    const tr = await api.notificationTypes();
    const types = tr.data || [];
    if (types.length) {
      area.append(
        el('h3', { style: { marginTop: '20px', fontSize: '15px' } }, '📋 Доступные типы уведомлений (справочник)'),
        el('p', { class: 'page-subtitle' },
          'Эти уведомления отправляются автоматически при событиях в системе. ',
          'Каждый юзер выбирает в своём профиле, какие из них он хочет получать в МАХ (по умолчанию все).'),
      );
      const tableRows = types.map((t) => el('tr', {},
        el('td', { style: { fontFamily: 'monospace', fontSize: '11px' } }, t.key),
        el('td', {}, el('b', {}, t.label), el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, t.description)),
        el('td', { style: { fontFamily: 'monospace', fontSize: '11px' } }, t.template),
        el('td', { style: { fontSize: '11px' } }, t.roles.join(', ')),
      ));
      area.append(el('div', { class: 'table-wrap', style: { marginTop: '8px' } },
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Ключ'), el('th', {}, 'Название / описание'),
            el('th', {}, 'Шаблон'), el('th', {}, 'Роли'))),
          el('tbody', {}, ...tableRows),
        ),
      ));
    }
  } catch { /* справочник недоступен — не критично */ }
}



// AI-предложения: inbox админа от AI-ассистента. Каждое предложение можно
// принять (AI выполнит на следующем обходе), отправить на доработку
// (с заметкой что AI должен пересмотреть) или отклонить.
export async function renderAiInbox(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') {
    main.innerHTML = '';
    main.append(el('div', { class: 'card' }, 'Раздел доступен только администратору.'));
    return;
  }

  const state = { status: 'pending' };
  const tableArea = el('div');

  function statusBadge(s) {
    const map = {
      pending: ['⏳ Ждёт решения', '#fed7aa', '#9a3412'],
      approved: ['✅ Принято', '#dcfce7', '#166534'],
      rejected: ['❌ Отклонено', '#fecaca', '#991b1b'],
      revision: ['↩️ На доработку', '#fef3c7', '#854d0e'],
      done: ['🎯 Выполнено', '#dbeafe', '#1e40af'],
    };
    const [label, bg, fg] = map[s] || [s, '#eee', '#444'];
    return el('span', { style: { background: bg, color: fg, padding: '2px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 } }, label);
  }

  function riskBadge(r) {
    const map = {
      low: ['🟢 низкий риск', '#dcfce7', '#166534'],
      medium: ['🟡 средний риск', '#fef3c7', '#854d0e'],
      high: ['🔴 высокий риск', '#fee2e2', '#991b1b'],
    };
    const [label, bg, fg] = map[r] || [r || '—', '#eee', '#444'];
    return el('span', { style: { background: bg, color: fg, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500 } }, label);
  }

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.listAiProposals({ status: state.status });
      renderList(r.data || []);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message || 'Ошибка'));
    }
  }

  async function decide(p, decision, notes = null) {
    try {
      await api.decideAiProposal(p.id, decision, notes);
      toast('Решение записано', 'success');
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Тред заметок на предложении: список + textarea + кнопка «Добавить».
  // Lazy-load: тянем messages при раскрытии. Видимо как сворачиваемый блок.
  function renderProposalThread(p) {
    const wrap = el('div', { class: 'ai-proposal-thread', style: { marginTop: '10px' } });
    const toggle = el('button', {
      type: 'button',
      class: 'btn btn-sm',
      style: { background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a' },
    }, '💬 Заметки / уточнения');
    const messagesArea = el('div', { class: 'ai-proposal-messages', style: { display: 'none', marginTop: '10px' } });
    let loaded = false;
    let loading = false;

    async function load() {
      loading = true;
      clear(messagesArea);
      messagesArea.append(el('div', { class: 'muted', style: { fontSize: '13px' } }, 'Загружаю…'));
      try {
        const r = await api.aiProposalMessages(p.id);
        clear(messagesArea);
        const msgs = r.data || [];
        if (!msgs.length) {
          messagesArea.append(el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, 'Пока нет заметок. Напишите свою — AI прочитает на следующем обходе.'));
        } else {
          for (const m of msgs) {
            messagesArea.append(
              el('div', { class: 'ai-proposal-msg', style: { marginBottom: '8px', padding: '8px 10px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px' } },
                el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' } },
                  `${m.user_name || 'Аноним'} · ${fmtDateTime(m.created_at)}`),
                el('div', { style: { whiteSpace: 'pre-wrap' } }, m.text),
              ),
            );
          }
        }
        const ta = el('textarea', {
          rows: '3',
          placeholder: 'Добавить заметку (вопрос к AI, уточнение, контекст)…',
          style: { width: '100%', fontFamily: 'inherit', fontSize: '13px', padding: '8px', boxSizing: 'border-box' },
        });
        const sendBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Добавить заметку');
        async function send() {
          const text = ta.value.trim();
          if (!text) return;
          sendBtn.disabled = true;
          const orig = sendBtn.textContent;
          sendBtn.textContent = '⏳ Сохраняю…';
          try {
            await api.postAiProposalMessage(p.id, text);
            ta.value = '';
            await load();
          } catch (e) {
            toast(e.message || 'Не удалось сохранить', 'error');
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = orig;
          }
        }
        sendBtn.addEventListener('click', send);
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
        });
        messagesArea.append(
          el('div', { style: { marginTop: '8px' } }, ta),
          el('div', { style: { marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            el('span', { class: 'muted', style: { fontSize: '11px' } }, 'Ctrl+Enter — быстро отправить'),
            sendBtn,
          ),
        );
        loaded = true;
      } catch (e) {
        clear(messagesArea);
        messagesArea.append(el('div', { class: 'error' }, e.message || 'Ошибка'));
      } finally {
        loading = false;
      }
    }
    toggle.addEventListener('click', async () => {
      const isOpen = messagesArea.style.display !== 'none';
      messagesArea.style.display = isOpen ? 'none' : 'block';
      if (!isOpen && !loaded && !loading) await load();
    });
    wrap.append(toggle, messagesArea);
    return wrap;
  }

  function renderList(rows) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({
        icon: '🤖',
        title: state.status === 'pending' ? 'Нет предложений ждущих решения' : 'Ничего не найдено в этом фильтре',
        description: 'AI присылает сюда задачи которые требуют вашего одобрения — например, фичи с риском или неоднозначные правки.',
      }));
      return;
    }
    for (const p of rows) {
      const card = el('div', {
        class: 'card',
        style: { marginBottom: '12px', borderLeft: `4px solid ${p.risk === 'high' ? '#ef4444' : p.risk === 'low' ? '#22c55e' : '#f59e0b'}` },
      });
      let changes = p.proposed_changes;
      if (typeof changes === 'string') {
        try { changes = JSON.parse(changes); } catch { changes = null; }
      }
      card.append(
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
          el('div', { style: { flex: 1, minWidth: '200px' } },
            el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' } },
              `#${p.id} · ${p.category || '—'}${p.source ? ' · ' + p.source : ''} · ${fmtDateTime(p.created_at)}`),
            el('div', { style: { fontSize: '17px', fontWeight: 600 } }, p.title),
          ),
          el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            statusBadge(p.status),
            riskBadge(p.risk),
          ),
        ),
        p.feedback_id ? el('div', { style: { marginTop: '8px', fontSize: '13px' } },
          el('span', { class: 'muted' }, 'Связано с обращением: '),
          el('a', { href: '#/feedback' }, `#${p.feedback_id} — ${p.feedback_subject || ''}`),
          p.feedback_author_name ? el('span', { class: 'muted' }, ` · автор: ${p.feedback_author_name}`) : null,
        ) : null,
        el('div', { style: { marginTop: '10px', fontSize: '14px', whiteSpace: 'pre-wrap' } }, p.summary),
        Array.isArray(changes) && changes.length ? el('div', { style: { marginTop: '10px' } },
          el('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, 'Предполагаемые правки:'),
          el('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '13px' } },
            ...changes.map((c) => el('li', {},
              c.file ? el('code', { style: { fontSize: '12px', background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px' } }, c.file) : null,
              c.action ? ` — ${c.action}` : '',
              c.reason ? el('span', { style: { color: 'var(--text-muted)' } }, ` (${c.reason})`) : null,
            )),
          ),
        ) : null,
        p.admin_notes ? el('div', { style: { marginTop: '10px', padding: '8px 10px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px' } },
          el('b', {}, 'Заметка админа: '),
          p.admin_notes,
          p.admin_decision_by_name ? el('span', { class: 'muted' }, ` — ${p.admin_decision_by_name}, ${fmtDateTime(p.admin_decision_at)}`) : null,
        ) : null,
        renderProposalThread(p),
        ['pending', 'revision'].includes(p.status)
          ? el('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              el('button', {
                class: 'btn btn-primary',
                onClick: async () => {
                  if (!(await confirm('Принять? AI выполнит это на следующем обходе.'))) return;
                  await decide(p, 'approved');
                },
              }, '✅ Принять'),
              el('button', {
                class: 'btn',
                onClick: async () => {
                  const notes = prompt('Что AI должен исправить / уточнить?');
                  if (!notes || !notes.trim()) return;
                  await decide(p, 'revision', notes.trim());
                },
              }, '↩️ На доработку'),
              el('button', {
                class: 'btn btn-danger',
                onClick: async () => {
                  const reason = prompt('Причина отказа (опционально):') || null;
                  if (!(await confirm('Отклонить предложение?'))) return;
                  await decide(p, 'rejected', reason);
                },
              }, '❌ Отклонить'),
            )
          : p.status === 'approved'
            ? el('div', { style: { marginTop: '10px', fontSize: '13px', color: 'var(--text-muted)' } },
                'Ожидает выполнения AI. После выполнения статус сменится на «🎯 Выполнено».')
            : null,
      );
      tableArea.append(card);
    }
  }

  const filterSel = el('select', {},
    el('option', { value: 'pending', selected: state.status === 'pending' }, 'Ждут решения'),
    el('option', { value: 'approved', selected: state.status === 'approved' }, 'Принятые'),
    el('option', { value: 'revision', selected: state.status === 'revision' }, 'На доработке'),
    el('option', { value: 'rejected', selected: state.status === 'rejected' }, 'Отклонённые'),
    el('option', { value: 'done', selected: state.status === 'done' }, 'Выполненные'),
    el('option', { value: '', selected: !state.status }, 'Все'),
  );
  filterSel.addEventListener('change', () => { state.status = filterSel.value; reload(); });

  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '🤖 AI-предложения'),
    el('div', { class: 'page-subtitle' },
      'Inbox от AI-ассистента. Каждое утро (по расписанию) AI обходит обращения пользователей: что-то делает сам, а спорное и потенциально опасное присылает сюда на ваше решение.'),
    el('div', { class: 'filter-bar', style: { marginBottom: '12px' } },
      el('label', {}, 'Фильтр: ', filterSel),
    ),
    tableArea,
  );
  await reload();
}

// Управление баннерами уведомлений на сайте (Настройки → блок). Только админ.
async function renderNoticeBannersSection(area) {
  clear(area);
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') return;
  area.append(
    el('div', { class: 'section-header' }, el('h2', {}, '📣 Уведомление-полоска сверху сайта')),
    el('p', { class: 'help-banner' },
      'Создавайте баннеры (info / warning / success / error) с длительностью в днях. ',
      'Видят все пользователи; могут закрыть — баннер прячется до следующего входа.'),
  );

  const listArea = el('div', { style: { marginTop: '10px' } });
  area.append(listArea);

  async function reload() {
    clear(listArea);
    listArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.listBanners();
      renderList(r.data || []);
    } catch (e) {
      clear(listArea);
      listArea.append(el('div', { class: 'error' }, e.message || 'Ошибка'));
    }
  }

  function kindBadge(k) {
    const map = { info: '#dbeafe', warning: '#fef3c7', success: '#dcfce7', error: '#fee2e2' };
    return el('span', { style: { background: map[k] || '#eee', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 } }, k);
  }

  function renderList(rows) {
    clear(listArea);
    if (!rows.length) {
      listArea.append(el('p', { class: 'muted' }, 'Баннеров пока нет.'));
    } else {
      for (const b of rows) {
        const card = el('div', {
          class: 'card',
          style: { marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start', borderLeft: `4px solid ${b.is_active ? '#22c55e' : '#9ca3af'}` },
        },
          el('div', { style: { flex: 1 } },
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' } },
              kindBadge(b.kind),
              el('span', { class: 'muted', style: { fontSize: '12px' } },
                b.is_active ? '🟢 Активен' : '⚪ Истёк',
                ` · до ${fmtDateTime(b.ends_at)}`,
              ),
            ),
            el('div', { style: { whiteSpace: 'pre-wrap' } }, b.text),
          ),
          el('button', {
            class: 'btn btn-sm btn-danger',
            onClick: async () => {
              if (!(await confirm('Удалить баннер?'))) return;
              try { await api.deleteBanner(b.id); toast('Удалён', 'success'); reload(); }
              catch (e) { toast(e.message, 'error'); }
            },
          }, '🗑 Удалить'),
        );
        listArea.append(card);
      }
    }
  }

  // Форма создания.
  const textI = el('textarea', { rows: '2', placeholder: 'Текст баннера', style: { width: '100%' } });
  const kindI = el('select', {},
    el('option', { value: 'info' }, 'ℹ️ Info'),
    el('option', { value: 'warning', selected: true }, '⚠️ Warning'),
    el('option', { value: 'success' }, '✅ Success'),
    el('option', { value: 'error' }, '❌ Error'),
  );
  const daysI = el('input', { type: 'number', min: '1', max: '365', value: '3', style: { width: '70px' } });
  const dismissibleI = el('input', { type: 'checkbox', checked: true });
  area.append(
    el('h3', { style: { marginTop: '16px', fontSize: '15px' } }, '➕ Создать баннер'),
    el('div', { class: 'form-row' }, el('label', {}, 'Текст'), textI),
    el('div', { class: 'form-row', style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
      el('label', {}, 'Тип: ', kindI),
      el('label', {}, 'Срок: ', daysI, ' дней'),
      el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, dismissibleI, 'Можно скрыть'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          const text = textI.value.trim();
          if (!text) { toast('Введите текст', 'error'); return; }
          try {
            await api.createBanner({
              text,
              kind: kindI.value,
              duration_days: Number(daysI.value) || 3,
              dismissible: dismissibleI.checked,
            });
            toast('Баннер создан', 'success');
            textI.value = '';
            reload();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, 'Создать'),
    ),
  );

  reload();
}

// Проекты: справочник для группировки лидов/сделок/контактов/компаний.
// Только админ видит этот блок. Список с цветными стикерами + форма ввода.
async function renderProjectsSection(area) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (me.role !== 'admin') return;
  area.append(
    el('div', { class: 'section-header' }, el('h2', {}, '🏷️ Проекты')),
    el('p', { class: 'help-banner' },
      'Заведите проекты, по которым работаете (например: «Электростальский ассортимент», «B2B-канал», «Опт МСК»). ',
      'На лиде/сделке/контакте/компании появится стикер, и в воронке можно будет фильтровать по проектам.',
    ),
  );

  const listArea = el('div', { style: { marginTop: '10px' } });
  area.append(listArea);

  async function reload() {
    clear(listArea);
    listArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.projectsList(false);
      // Обновляем глобальный кеш, чтобы стикеры/выпадашки сразу подхватили изменения.
      CACHE.projects = (r.data || []).filter((p) => p.active);
      renderList(r.data || []);
    } catch (e) {
      clear(listArea);
      listArea.append(el('div', { class: 'error' }, e.message || 'Ошибка'));
    }
  }

  function renderList(rows) {
    clear(listArea);
    if (!rows.length) {
      listArea.append(el('p', { class: 'muted' }, 'Проектов пока нет. Создайте первый.'));
      return;
    }
    for (const p of rows) {
      const nameI = el('input', { type: 'text', value: p.name, style: { width: '220px' } });
      const colorI = el('input', { type: 'color', value: p.color || '#6366f1', style: { width: '50px', padding: '0' } });
      const activeI = el('input', { type: 'checkbox', checked: !!p.active });
      const prodI = el('input', { type: 'checkbox', checked: !!p.is_production });
      const sticker = el('span', {
        class: 'project-sticker',
        style: { background: p.color || '#6366f1' },
      }, p.name);
      const card = el('div', { class: 'card', style: { marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
        sticker,
        el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, 'Имя:', nameI),
        el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, 'Цвет:', colorI),
        el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, activeI, 'Активен'),
        el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' }, title: 'Доход с этого проекта попадёт в P&L производства (раздел «💰 Доходность»).' }, prodI, '🏭 Производственный'),
        el('button', {
          class: 'btn btn-sm btn-primary',
          onClick: async () => {
            try {
              await api.projectUpdate(p.id, {
                name: nameI.value.trim(),
                color: colorI.value,
                active: activeI.checked,
                is_production: prodI.checked,
              });
              toast('Сохранено', 'success');
              reload();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, '💾 Сохранить'),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onClick: async () => {
            if (!(await confirm(`Удалить проект «${p.name}»? Привязанные записи останутся без проекта.`))) return;
            try { await api.projectDelete(p.id); toast('Удалён', 'success'); reload(); }
            catch (e) { toast(e.message, 'error'); }
          },
        }, '🗑'),
      );
      listArea.append(card);
    }
  }

  // Форма создания нового проекта.
  const newNameI = el('input', { type: 'text', placeholder: 'Название проекта', style: { width: '220px' } });
  const newColorI = el('input', { type: 'color', value: '#6366f1', style: { width: '50px', padding: '0' } });
  area.append(
    el('h3', { style: { marginTop: '16px', fontSize: '15px' } }, '➕ Новый проект'),
    el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      newNameI, newColorI,
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          const name = newNameI.value.trim();
          if (!name) { toast('Введите имя проекта', 'error'); return; }
          try {
            await api.projectCreate({ name, color: newColorI.value });
            toast('Проект создан', 'success');
            newNameI.value = '';
            reload();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, 'Создать'),
    ),
  );

  reload();
}

// Карточка PWA push-уведомлений в «Мой профиль».
function buildPushProfileCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { fontWeight: '600', fontSize: '15px', marginBottom: '4px' } }, '📲 PWA push-уведомления'));
  const hint = el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' } },
    'Уведомления от CRM прямо в шторку устройства (Android/десктоп) или на Home Screen (iOS PWA 16.4+). Работает даже когда CRM закрыта.');
  card.append(hint);
  const statusLine = el('div', { style: { fontSize: '13px', marginBottom: '8px' } }, 'Проверяю статус…');
  card.append(statusLine);
  const btnRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  card.append(btnRow);
  // Diagnostic-панель: показывает всё сразу (endpoint браузера, кол-во подписок
  // на сервере, VAPID public key, результат последнего действия). Помогает
  // разобраться, когда браузер уверен что подписан, а сервер не находит.
  const diagBox = el('pre', {
    style: {
      fontSize: '11px', background: '#f3f4f6', padding: '8px', borderRadius: '6px',
      marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'none',
    },
  });
  card.append(diagBox);

  async function collectDiag(headline) {
    const lines = [headline || 'Диагностика:'];
    // Клиент
    const st = await getPushLocalStatus().catch((e) => ({ error: e.message }));
    lines.push('--- Браузер ---');
    lines.push('supported: ' + st.supported);
    lines.push('permission: ' + st.permission);
    lines.push('subscribed: ' + st.subscribed);
    if (st.subscription) {
      const json = st.subscription.toJSON();
      lines.push('endpoint: ' + (json.endpoint || '').slice(0, 100) + '…');
      lines.push('has p256dh: ' + !!(json.keys && json.keys.p256dh));
      lines.push('has auth: ' + !!(json.keys && json.keys.auth));
    }
    // Сервер
    lines.push('--- Сервер ---');
    try {
      const srv = await api.pushStatus();
      lines.push('enabled: ' + srv.enabled);
      lines.push('subscriptions в БД: ' + srv.subscriptions);
    } catch (e) { lines.push('Ошибка /status: ' + e.message); }
    try {
      const vk = await api.pushVapidKey();
      lines.push('VAPID publicKey (последние 8): …' + (vk.key || '').slice(-8));
    } catch (e) { lines.push('Ошибка /vapid-key: ' + e.message); }
    return lines.join('\n');
  }

  async function refresh() {
    btnRow.textContent = '';
    let st;
    try { st = await getPushLocalStatus(); }
    catch (e) { statusLine.textContent = 'Ошибка: ' + (e.message || e); return; }
    if (!st.supported) {
      statusLine.textContent = 'ℹ️ Push не поддерживается в этом браузере. На iPhone: добавь CRM на Home Screen как PWA (iOS 16.4+).';
      return;
    }
    if (st.permission === 'denied') {
      statusLine.textContent = '⚠️ Push заблокирован в настройках браузера/устройства. Разреши уведомления для этого сайта в настройках браузера.';
      return;
    }
    if (st.subscribed) {
      statusLine.textContent = '✅ Push включён на этом устройстве';
      statusLine.style.color = '#15803d';
      const testBtn = el('button', { class: 'btn btn-primary' }, '📤 Отправить тестовое уведомление');
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        try {
          const r = await sendTestPush();
          if (r.sent) {
            toast(`Тест отправлен (${r.sent} шт) — проверь шторку`, 'success');
          } else {
            // Если push-провайдер (Apple/Firefox/Chrome) отбросил — покажем что именно.
            const errs = r.errors || [];
            const summary = errs.length
              ? errs.map((e) => `${e.statusCode || '?'} ${e.body || ''}`).join(' | ')
              : 'подписок не найдено';
            const diag = await collectDiag(`❌ Push НЕ доставлен: ${summary}`);
            diagBox.textContent = diag; diagBox.style.display = '';
            toast(`Push отклонён провайдером: ${summary}`, 'error');
          }
        } catch (e) { toast(e.message, 'error'); }
        testBtn.disabled = false;
      });
      // «Пересоздать» — принудительный full re-subscribe. Спасает, когда браузер
      // помнит подписку с ЧУЖИМ VAPID / БД чужая / вручную кто-то удалил из БД.
      const recreateBtn = el('button', { class: 'btn' }, '🔧 Пересоздать подписку');
      recreateBtn.addEventListener('click', async () => {
        recreateBtn.disabled = true;
        try {
          // Полный сброс: отписаться и локально, и на сервере.
          await unsubscribeFromPush();
          await subscribeToPush();
          const chk = await api.pushStatus();
          if (chk.subscriptions > 0) {
            toast(`Пересоздано. Подписок на сервере: ${chk.subscriptions}`, 'success');
          } else {
            const diag = await collectDiag('❌ Не удалось: подписок на сервере 0.');
            diagBox.textContent = diag; diagBox.style.display = '';
            toast('Пересоздать не удалось — раскрыл диагностику ниже', 'error');
          }
        } catch (e) {
          const diag = await collectDiag('❌ Ошибка пересоздания: ' + e.message);
          diagBox.textContent = diag; diagBox.style.display = '';
          toast(e.message, 'error');
        }
        recreateBtn.disabled = false;
        refresh();
      });
      const offBtn = el('button', { class: 'btn' }, '🔕 Отключить на этом устройстве');
      offBtn.addEventListener('click', async () => {
        if (!(await confirm('Отписаться от push-уведомлений на этом устройстве?'))) return;
        offBtn.disabled = true;
        try { await unsubscribeFromPush(); toast('Push отключён на этом устройстве', 'success'); }
        catch (e) { toast(e.message, 'error'); }
        offBtn.disabled = false;
        refresh();
      });
      const diagBtn = el('button', { class: 'btn', title: 'Показать что видит браузер и сервер' }, '🔎 Диагностика');
      diagBtn.addEventListener('click', async () => {
        diagBtn.disabled = true;
        try { const d = await collectDiag('📋 Состояние push:'); diagBox.textContent = d; diagBox.style.display = ''; }
        catch (e) { diagBox.textContent = 'Ошибка: ' + e.message; diagBox.style.display = ''; }
        diagBtn.disabled = false;
      });
      btnRow.append(testBtn, recreateBtn, offBtn, diagBtn);
    } else {
      statusLine.textContent = 'Push пока не включён на этом устройстве';
      statusLine.style.color = 'var(--text-muted)';
      const onBtn = el('button', { class: 'btn btn-primary' }, '📲 Включить push на этом устройстве');
      onBtn.addEventListener('click', async () => {
        onBtn.disabled = true;
        try {
          await subscribeToPush();
          const chk = await api.pushStatus();
          if (chk.subscriptions > 0) toast(`Готово! Подписок на сервере: ${chk.subscriptions}`, 'success');
          else {
            const diag = await collectDiag('⚠️ Локально подписался, но на сервере не сохранилось.');
            diagBox.textContent = diag; diagBox.style.display = '';
            toast('Подписка не долетела до сервера — раскрыл диагностику ниже', 'error');
          }
        } catch (e) {
          const diag = await collectDiag('❌ Ошибка подписки: ' + e.message);
          diagBox.textContent = diag; diagBox.style.display = '';
          toast(e.message || 'Не удалось подписаться', 'error');
        }
        onBtn.disabled = false;
        refresh();
      });
      const diagBtn = el('button', { class: 'btn' }, '🔎 Диагностика');
      diagBtn.addEventListener('click', async () => {
        try { const d = await collectDiag('📋 Состояние push:'); diagBox.textContent = d; diagBox.style.display = ''; }
        catch (e) { diagBox.textContent = 'Ошибка: ' + e.message; diagBox.style.display = ''; }
      });
      btnRow.append(onBtn, diagBtn);
    }
  }
  refresh();
  return card;
}

// Мой профиль: настройки уведомлений в МАХ. По умолчанию все галочки включены —
// при сохранении только изменённые от дефолта пишутся в user_notification_prefs.
export async function renderMyProfile(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '👤 Мой профиль'),
    el('div', { class: 'page-subtitle' },
      'Настройки уведомлений действуют для PWA (push на устройство) и МАХ-бота одновременно. В колокольчике внутри CRM события появятся в любом случае.'),
  );

  const meBlock = el('div', { class: 'card', style: { marginBottom: '12px' } },
    el('div', { class: 'detail-grid' },
      el('div', { class: 'k' }, 'Имя'), el('div', {}, me.name || '—'),
      el('div', { class: 'k' }, 'Email'), el('div', {}, me.email || '—'),
      el('div', { class: 'k' }, 'Роль'), el('div', {}, tr('role', me.role) || me.role),
    ),
  );
  main.append(meBlock);

  // ---- PWA push-уведомления ----
  main.append(buildPushProfileCard());

  // Смена пароля. Валидация на бэке: текущий должен совпадать, новый ≥6 символов и
  // отличаться от старого. После успеха поля очищаются.
  const pwCurrent = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль' });
  const pwNext = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль (≥6 символов)' });
  const pwConfirm = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Повторите новый пароль' });
  const pwStatus = el('div', { style: { marginTop: '8px', fontSize: '13px' } });
  const pwBtn = el('button', { class: 'btn btn-primary' }, '🔐 Сменить пароль');
  pwBtn.addEventListener('click', async () => {
    pwStatus.textContent = '';
    pwStatus.style.color = '';
    const cur = pwCurrent.value;
    const nxt = pwNext.value;
    const cnf = pwConfirm.value;
    if (!cur || !nxt) { pwStatus.style.color = '#b91c1c'; pwStatus.textContent = 'Заполните оба поля'; return; }
    if (nxt.length < 6) { pwStatus.style.color = '#b91c1c'; pwStatus.textContent = 'Новый пароль слишком короткий (нужно ≥6 символов)'; return; }
    if (nxt !== cnf) { pwStatus.style.color = '#b91c1c'; pwStatus.textContent = 'Подтверждение не совпадает с новым паролем'; return; }
    pwBtn.disabled = true;
    const orig = pwBtn.textContent;
    pwBtn.textContent = '⏳ Сохраняю…';
    try {
      await api.changePassword(cur, nxt);
      pwCurrent.value = ''; pwNext.value = ''; pwConfirm.value = '';
      pwStatus.style.color = '#15803d';
      pwStatus.textContent = '✅ Пароль изменён';
      toast('Пароль изменён', 'success');
    } catch (e) {
      pwStatus.style.color = '#b91c1c';
      pwStatus.textContent = '❌ ' + (e.message || 'Ошибка');
    } finally {
      pwBtn.disabled = false;
      pwBtn.textContent = orig;
    }
  });
  main.append(el('div', { class: 'card', style: { marginBottom: '12px' } },
    el('h3', { style: { marginTop: 0 } }, '🔐 Смена пароля'),
    el('div', { style: { display: 'grid', gap: '8px', maxWidth: '380px' } },
      pwCurrent, pwNext, pwConfirm,
    ),
    el('div', { style: { marginTop: '12px' } }, pwBtn),
    pwStatus,
  ));

  // Принудительный сброс PWA — выручает iOS-PWA когда сидит на старой версии и
  // баннер «🔄 Доступна новая версия» не появился (бывает при первом запуске
  // после долгого простоя, когда SW не успел обнаружить смену версии).
  // Под капотом: unregister всех SW + чистка caches + reload с _pwa=ts.
  const forceBtn = el(
    'button',
    { class: 'btn' },
    '🔁 Принудительно обновить приложение',
  );
  forceBtn.addEventListener('click', async () => {
    if (!(await confirm('Принудительно перезагрузить PWA? Это уберёт кеш SW и обновит до последней версии. Несохранённые формы потеряются.'))) return;
    forceBtn.disabled = true;
    forceBtn.textContent = '⏳ Чищу кеш…';
    if (typeof window.forceRefreshPwa === 'function') {
      await window.forceRefreshPwa();
    } else {
      location.reload();
    }
  });
  main.append(el('div', { class: 'card', style: { marginBottom: '12px' } },
    el('h3', { style: { marginTop: 0 } }, '🔁 Обновление приложения'),
    el('p', { style: { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' } },
      'Если в PWA не появились последние изменения, а баннер «Обновить» не выскочил — нажмите, чтобы принудительно обновиться. Помогает на iOS, где PWA иногда залипает на старой версии.'),
    forceBtn,
  ));

  const maxStatus = el('div', { class: 'card', style: { marginBottom: '12px' } },
    el('h3', { style: { marginTop: 0 } }, '🔔 МАХ-уведомления'),
    el('div', { class: 'loading' }, 'Проверяю статус…'),
  );
  main.append(maxStatus);

  const prefsArea = el('div', { class: 'card' },
    el('h3', { style: { marginTop: 0 } }, '⚙️ Что получать в МАХ'),
    el('div', { class: 'loading' }, 'Загрузка…'),
  );
  main.append(prefsArea);

  // Статус МАХ-привязки.
  try {
    const me2 = await api.maxMe();
    clear(maxStatus);
    maxStatus.append(
      el('h3', { style: { marginTop: 0 } }, '🔔 МАХ-уведомления'),
      me2.bound
        ? el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
            el('span', { style: { color: 'green', fontWeight: 600 } }, '✅ МАХ подключён'),
            el('button', { class: 'btn btn-sm', onClick: () => openMaxBindDialog() }, '⚙️ Настроить / отвязать'),
          )
        : el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
            el('span', { style: { color: 'var(--text-muted)' } }, '⚪ МАХ не подключён — уведомления приходят только в колокольчик'),
            el('button', { class: 'btn btn-primary btn-sm', onClick: () => openMaxBindDialog() }, '🔗 Подключить МАХ'),
          ),
    );
  } catch (e) {
    clear(maxStatus);
    maxStatus.append(el('div', { class: 'error' }, e.message || 'Ошибка'));
  }

  // Настройки prefs — типы уведомлений, применяются к PWA push И к MAX.
  try {
    const r = await api.myNotificationPrefs();
    clear(prefsArea);
    prefsArea.append(el('h3', { style: { marginTop: 0 } }, '🔔 Типы уведомлений (для PWA и МАХ)'));
    prefsArea.append(el('div', {
      style: { padding: '8px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', fontSize: '12px', color: '#1e40af', marginBottom: '10px' },
    },
      '💡 Один тумблер на каждый тип — управляет и push в PWA, и сообщением в МАХ-боте. ',
      'Отключённые типы всё равно попадают в 🔔 колокольчик внутри CRM — вы ничего не пропустите. ',
      'Чтобы полностью отключить push на устройстве, снимите разрешение в настройках браузера или через кнопку в карточке «PWA push» выше.',
    ));
    if (!r.data?.length) {
      prefsArea.append(el('p', { class: 'muted' }, 'Для вашей роли нет настраиваемых уведомлений.'));
      return;
    }
    // Группируем по t.group.
    const byGroup = {};
    for (const t of r.data) (byGroup[t.group || 'Общее'] = byGroup[t.group || 'Общее'] || []).push(t);
    const checkboxes = [];
    // Порядок групп — фиксированный.
    const order = ['Заявки на производство', 'Продажи и склад', 'Обращения', 'Общее'];
    const groups = Object.keys(byGroup).sort((a, b) => (order.indexOf(a) + 100) - (order.indexOf(b) + 100));
    for (const g of groups) {
      prefsArea.append(el('div', {
        style: { fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '12px', paddingBottom: '4px', borderBottom: '2px solid #e5e7eb' },
      }, g));
      // Groups «toggle all» — быстрая кнопка вкл/выкл всех типов группы.
      const allBtn = el('button', {
        class: 'btn btn-sm', type: 'button', style: { float: 'right', marginTop: '-24px', fontSize: '11px', padding: '2px 8px' },
      }, 'вкл/выкл группу');
      prefsArea.append(allBtn);
      const groupCbs = [];
      for (const t of byGroup[g]) {
        const cb = el('input', { type: 'checkbox', checked: t.enabled !== false });
        checkboxes.push({ key: t.key, input: cb });
        groupCbs.push(cb);
        prefsArea.append(el('label', {
          style: { display: 'flex', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', alignItems: 'flex-start' },
        },
          cb,
          el('div', {},
            el('div', { style: { fontWeight: 600 } }, t.label),
            el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' } }, t.description),
            el('div', { style: { fontSize: '11px', color: '#0369a1', marginTop: '4px', fontFamily: 'monospace' } }, 'Пример: ' + t.template),
          ),
        ));
      }
      allBtn.addEventListener('click', () => {
        const anyChecked = groupCbs.some((c) => c.checked);
        for (const c of groupCbs) c.checked = !anyChecked;
      });
    }
    const saveStatus = el('span', { class: 'save-status', style: { marginLeft: '12px' } });
    prefsArea.append(el('div', { style: { marginTop: '12px' } },
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          saveStatus.textContent = 'Сохраняю…';
          try {
            await api.updateNotificationPrefs(checkboxes.map((c) => ({ key: c.key, enabled: c.input.checked })));
            saveStatus.textContent = '✅ Сохранено';
            toast('Настройки уведомлений сохранены', 'success');
          } catch (e) { saveStatus.textContent = '❌ ' + e.message; toast(e.message, 'error'); }
        },
      }, '💾 Сохранить'),
      saveStatus,
    ));
  } catch (e) {
    clear(prefsArea);
    prefsArea.append(el('div', { class: 'error' }, e.message || 'Ошибка'));
  }
}

// ============================================================
// 🏭 Производственный модуль — UI
// ============================================================

// Хелперы видимости. master не видит cost_price материалов; foreman/supply
// видят. Везде где работаем с деньгами — ориентируемся на роль из storage.
function prodRole() {
  return JSON.parse(localStorage.getItem('crm_user') || '{}').role || '';
}
function canEditMaterials() { return ['admin', 'director_prod', 'supply'].includes(prodRole()); }
function canEditPlans() { return ['admin', 'director_prod', 'foreman'].includes(prodRole()); }
function canEditOrders() { return ['admin', 'director_prod', 'foreman'].includes(prodRole()); }
function canEditContracts() { return ['admin', 'director_prod'].includes(prodRole()); }
function canSeeProdCost() { return ['admin', 'director_prod', 'foreman', 'supply'].includes(prodRole()); }

// --- Материалы ---------------------------------------------------------------

export async function renderMaterials(main) {
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '🧱 Материалы'),
    el('div', { class: 'page-subtitle' }, 'Сырьё и комплектующие для производства. Закупочная цена видна снабжению, директору, начальнику цеха.'),
  );

  const state = { search: '', active: 'true' };
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.list('materials', state);
      renderTable(r.data || []);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message));
    }
  }

  function renderTable(rows) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({ icon: '🧱', title: 'Материалов пока нет', description: 'Добавьте первый материал кнопкой «Новый материал».' }));
      return;
    }
    const showCost = canSeeProdCost();
    const head = el('tr', {},
      el('th', {}, 'Артикул'),
      el('th', {}, 'Наименование'),
      el('th', {}, 'Ед.изм'),
      showCost ? el('th', {}, 'Закуп. цена') : null,
      el('th', {}, 'Поставщик'),
      el('th', { style: { textAlign: 'right' } }, ''),
    );
    const body = rows.map((r) => el('tr', { onClick: () => openForm(r) },
      el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, r.sku || '—'),
      el('td', {}, r.name),
      el('td', {}, r.unit || 'шт'),
      showCost ? el('td', {}, r.cost_price != null ? fmtMoney(r.cost_price, 'RUB') : '—') : null,
      el('td', {}, r.supplier || '—'),
      el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
        canEditMaterials() ? el('button', { class: 'btn btn-sm', onClick: () => openForm(r) }, 'Открыть') : null,
      ),
    ));
    tableArea.append(el('div', { class: 'table-wrap' },
      el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))));
  }

  async function openForm(material) {
    const isEdit = !!material;
    const fields = [
      { name: 'name', label: 'Наименование', required: true },
      { name: 'sku', label: 'Артикул' },
      { name: 'unit', label: 'Ед.изм (шт, м, кг, л)', default: 'шт' },
      // Конверсия: покупаем в одной единице (кг), храним/списываем в другой (м).
      // При оприходовании с qty_unit='purchase' бэк умножит на коэффициент.
      { name: 'unit_purchase', label: 'Закупочная ед.изм (опц. — если покупаете в другой, напр. кг)' },
      { name: 'purchase_to_unit_factor', label: 'Сколько основных ед. в 1 закупочной (напр. 6.5 м в 1 кг)', type: 'number' },
      ...(canSeeProdCost() ? [{ name: 'cost_price', label: 'Закупочная цена ₽', type: 'number' }] : []),
      { name: 'supplier', label: 'Поставщик' },
      { name: 'warehouse', label: 'Склад хранения' },
      { name: 'notes', label: 'Заметки', type: 'textarea' },
      { name: 'active', label: 'Активный', type: 'checkbox', default: true },
    ];
    const { node, getValues } = buildForm(fields, material || {});

    // Блок «Синхронизация с МойСклад» — только для существующего материала.
    if (isEdit) {
      const msInfo = el('div', { style: { marginTop: '12px', padding: '10px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px' } });
      function updateMsInfo(mat) {
        clear(msInfo);
        if (mat.ms_id) {
          msInfo.append(
            el('div', { style: { color: '#15803d' } }, '✅ Синхронизирован с МС'),
            el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' } }, 'ms_id: ' + mat.ms_id),
            mat.ms_synced_at ? el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, 'Последний синк: ' + fmtDateTime(mat.ms_synced_at)) : null,
          );
        } else if (mat.ms_sync_error) {
          msInfo.append(
            el('div', { style: { color: '#b91c1c' } }, '⚠️ Не синхронизирован: ' + mat.ms_sync_error),
          );
        } else {
          msInfo.append(el('div', { class: 'muted' }, 'Не синхронизирован с МС'));
        }
        const syncBtn = el('button', { class: 'btn btn-sm', style: { marginTop: '8px' } }, '🔄 Синхронизировать с МС');
        syncBtn.addEventListener('click', async () => {
          syncBtn.disabled = true;
          syncBtn.textContent = '⏳ Синхронизируем…';
          try {
            const updated = await api.syncMaterialMs(mat.id);
            material.ms_id = updated.ms_id;
            material.ms_sync_error = updated.ms_sync_error;
            material.ms_synced_at = updated.ms_synced_at;
            updateMsInfo(updated);
            if (updated.ms_id) toast('Синхронизирован', 'success');
            else toast('Не удалось: ' + (updated.ms_sync_error || 'неизвестно'), 'error');
          } catch (e) { toast(e.message, 'error'); }
          finally { syncBtn.disabled = false; syncBtn.textContent = '🔄 Синхронизировать с МС'; }
        });
        msInfo.append(syncBtn);
      }
      updateMsInfo(material);
      node.append(msInfo);
    }

    await openModal(isEdit ? `Материал: ${material.name}` : 'Новый материал', node, {
      primaryLabel: isEdit ? 'Сохранить' : 'Создать',
      onSubmit: async () => {
        const data = getValues();
        // cost_price может быть строкой — приводим к Number.
        if (data.cost_price != null && data.cost_price !== '') data.cost_price = Number(data.cost_price);
        else delete data.cost_price;
        // Конверсия: пустые поля не шлём (zod ждёт number|null), пара
        // «единица без коэффициента» бессмысленна — просим оба.
        const hasUnitP = data.unit_purchase != null && String(data.unit_purchase).trim() !== '';
        const hasFactor = data.purchase_to_unit_factor != null && String(data.purchase_to_unit_factor).trim() !== '';
        if (hasUnitP !== hasFactor) {
          toast('Для конверсии заполните оба поля: закупочную ед.изм и коэффициент', 'error');
          return false;
        }
        if (hasFactor) data.purchase_to_unit_factor = Number(data.purchase_to_unit_factor);
        else { data.unit_purchase = null; data.purchase_to_unit_factor = null; }
        if (isEdit) await api.update('materials', material.id, data);
        else await api.create('materials', data);
        toast(isEdit ? 'Сохранено' : 'Создано', 'success');
        await reload();
      },
    });
  }

  const searchInput = el('input', { type: 'search', placeholder: 'Поиск по названию/артикулу…', onInput: (e) => {
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(() => { state.search = e.target.value; reload(); }, 250);
  }});
  const activeFilter = el('select', { onChange: (e) => { state.active = e.target.value; reload(); } },
    el('option', { value: 'true', selected: true }, 'Активные'),
    el('option', { value: 'false' }, 'Архивные'),
    el('option', { value: '' }, 'Все'),
  );
  main.append(el('div', { class: 'toolbar' },
    searchInput, activeFilter,
    el('div', { class: 'spacer' }),
    canEditMaterials() ? el('button', { class: 'btn btn-primary', onClick: () => openForm(null) }, '+ Новый материал') : null,
  ), tableArea);
  reload();
}

// --- Техкарты ----------------------------------------------------------------

export async function renderProcessingPlans(main) {
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '🛠 Техкарты'),
    el('div', { class: 'page-subtitle' }, 'Состав готового товара: список материалов и норма труда на 1 единицу.'),
  );
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.list('processing-plans', {});
      renderTable(r.data || [], r.labor_rate_per_minute);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message));
    }
  }

  function renderTable(rows, rate) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({ icon: '🛠', title: 'Техкарт пока нет', description: 'Добавьте техкарту для товара кнопкой выше.' }));
      return;
    }
    const showCost = canSeeProdCost();
    const head = el('tr', {},
      el('th', {}, 'Товар'),
      el('th', {}, 'Артикул'),
      el('th', {}, 'Норма труда, мин'),
      showCost ? el('th', {}, 'Себестоимость 1 ед') : null,
      el('th', { style: { textAlign: 'right' } }, ''),
    );
    const body = rows.map((r) => el('tr', { onClick: () => openForm(r.id) },
      el('td', {}, r.product_name),
      el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, r.product_sku || '—'),
      el('td', {}, String(r.effective_labor_minutes ?? r.labor_minutes_per_unit ?? 0)),
      showCost ? el('td', {}, r.cost_per_unit != null ? fmtMoney(r.cost_per_unit, 'RUB') : '—') : null,
      el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
        canEditPlans() ? el('button', { class: 'btn btn-sm', onClick: () => openForm(r.id) }, 'Открыть') : null,
      ),
    ));
    tableArea.append(
      showCost && rate != null
        ? el('div', { class: 'hint', style: { fontSize: '12px' } }, `Ставка труда: ${rate.toLocaleString('ru-RU')} ₽/мин (Настройки → Производство → labor_rate_per_minute).`)
        : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))),
    );
  }

  async function openForm(planId) {
    let plan = { product_id: null, labor_minutes_per_unit: 0, items: [], stages: [], active: true };
    if (planId) plan = await api.get('processing-plans', planId);

    // Грузим материалы — для селектов внутри состава. Товары грузим лениво
    // через поиск (см. productPicker ниже): каталог из МС у клиента ~4000+
    // позиций, тащить всё разом — лишний трафик и дикая выпадашка.
    const materialsR = await api.list('materials', { active: 'true' });
    const materials = materialsR.data || [];

    // Если редактируем существующую техкарту — подгрузим выбранный товар по id,
    // чтобы показать его в шапке без обращения к полному каталогу.
    let initialProduct = null;
    if (plan.product_id) {
      try { initialProduct = await api.get('products', plan.product_id); } catch { /* not found */ }
    }

    // Если материалов нет вообще — подсказываем куда идти.
    const materialsHint = !materials.length
      ? el('div', { style: { padding: '10px', background: '#fef3c7', borderLeft: '4px solid #f59e0b', borderRadius: '6px', fontSize: '13px', marginBottom: '8px' } },
          '⚠️ Материалов пока нет. ',
          el('a', { href: '#/materials' }, 'Создайте их в разделе «🧱 Материалы»'),
          ' — они появятся в выпадашке.')
      : null;

    // Комбобокс выбора товара: ленивый поиск по каталогу (все товары, включая
    // импортированные из МС, без привязки к складу — у МС-карточки склада нет).
    // .value — id выбранного товара (строкой, как у нативного <select>).
    // При редактировании техкарты товар менять нельзя — показываем как лейбл.
    const productSel = { value: plan.product_id ? String(plan.product_id) : '' };
    function fmtProduct(p) {
      return `${p.name}${p.sku ? ' (' + p.sku + ')' : ''}`;
    }
    let productPickerNode;
    if (planId) {
      productPickerNode = el('div', { class: 'hint', style: { padding: '8px 10px', background: '#f3f4f6', borderRadius: '6px' } },
        initialProduct ? fmtProduct(initialProduct) : `товар id=${plan.product_id} (загружен не был)`,
      );
    } else {
      const input = el('input', { type: 'search', placeholder: 'Начните вводить название или артикул…', style: { width: '100%' } });
      const list = el('div', { style: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: '240px', overflowY: 'auto', zIndex: '10', display: 'none' } });
      const wrap = el('div', { style: { position: 'relative' } }, input, list);
      let debounceTimer;
      let lastRows = [];
      async function search() {
        const q = input.value.trim();
        if (!q) { list.style.display = 'none'; return; }
        try {
          // У /api/products есть полнотекстовый search (см. routes/products.js).
          const r = await api.list('products', { limit: 30, active: 'true', search: q });
          lastRows = r.data || [];
        } catch { lastRows = []; }
        clear(list);
        if (!lastRows.length) {
          list.append(el('div', { class: 'hint', style: { padding: '8px 10px' } }, 'Ничего не нашлось'));
        } else {
          for (const p of lastRows) {
            const item = el('div', { style: { padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border)' } }, fmtProduct(p));
            item.addEventListener('mouseenter', () => { item.style.background = '#f3f4f6'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            item.addEventListener('click', () => {
              productSel.value = String(p.id);
              input.value = fmtProduct(p);
              list.style.display = 'none';
            });
            list.append(item);
          }
        }
        list.style.display = 'block';
      }
      input.addEventListener('input', () => {
        productSel.value = ''; // редактирование текста сбрасывает выбор до подтверждения
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(search, 250);
      });
      input.addEventListener('focus', () => { if (input.value.trim()) search(); });
      // Клик вне комбобокса — закрыть список (но не если кликнули по элементу списка — там свой handler выше).
      document.addEventListener('mousedown', (e) => {
        if (!wrap.contains(e.target)) list.style.display = 'none';
      });
      productPickerNode = wrap;
    }

    const itemsArea = el('div', { class: 'plan-items', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } });
    function addItemRow(item) {
      const matSel = el('select', {},
        el('option', { value: '' }, '— материал —'),
        ...materials.map((m) => el('option', { value: String(m.id), selected: item && m.id === item.material_id }, `${m.name}${m.sku ? ' (' + m.sku + ')' : ''}${m.unit ? ' — ' + m.unit : ''}`)),
      );
      const qtyI = el('input', { type: 'number', min: '0', step: '0.001', value: item ? String(item.qty_per_unit) : '', placeholder: 'Норма на 1 ед', style: { width: '120px' } });
      const removeBtn = el('button', { class: 'btn btn-sm', onClick: () => row.remove() }, '×');

      // Разбивка по типоразмерам: сколько штук какого размера/длины
      const initSizes = Array.isArray(item?.sizes) ? item.sizes : [];
      const sizesArea = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', paddingLeft: '4px', borderLeft: '2px solid var(--border)' } });
      function addSizeRow(sz) {
        const cntI = el('input', { type: 'number', min: '1', step: '1', value: sz ? String(sz.count) : '', placeholder: 'кол-во', style: { width: '80px' } });
        const lblI = el('input', { type: 'text', value: sz ? sz.label : '', placeholder: 'типоразмер (напр. 1200мм)', style: { flex: 1, minWidth: '100px' } });
        const delBtn = el('button', { class: 'btn btn-sm', onClick: () => szRow.remove() }, '×');
        const szRow = el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, cntI, lblI, delBtn);
        szRow._cnt = cntI; szRow._lbl = lblI;
        sizesArea.append(szRow);
      }
      for (const sz of initSizes) addSizeRow(sz);

      const sizesToggle = el('span', { style: { fontSize: '12px', cursor: 'pointer', color: 'var(--text-muted)', userSelect: 'none' } },
        initSizes.length ? `▾ типоразмеры (${initSizes.length})` : '▸ типоразмеры',
      );
      const sizesBlock = el('div', {},
        sizesArea,
        el('div', { style: { marginTop: '4px' } },
          el('button', { type: 'button', class: 'btn btn-sm', onClick: () => addSizeRow() }, '+ типоразмер'),
        ),
      );
      sizesBlock.style.display = initSizes.length ? 'block' : 'none';
      sizesToggle.addEventListener('click', () => {
        const shown = sizesBlock.style.display !== 'none';
        sizesBlock.style.display = shown ? 'none' : 'block';
        sizesToggle.textContent = shown ? '▸ типоразмеры' : '▾ типоразмеры';
      });

      const topRow = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, matSel, qtyI, sizesToggle, removeBtn);
      const row = el('div', { class: 'plan-item-row', style: { display: 'flex', flexDirection: 'column' } }, topRow, sizesBlock);
      row._sel = matSel; row._qty = qtyI; row._sizesArea = sizesArea;
      itemsArea.append(row);
    }
    for (const it of plan.items || []) addItemRow(it);
    if (!plan.items?.length) addItemRow();

    // Этапы изготовления + время на каждый. Сумма минут используется как
    // общая норма труда; labor_minutes_per_unit оставлен для совместимости.
    const stagesArea = el('div', { class: 'plan-stages', style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' } });
    const stagesTotalEl = el('span', { style: { fontWeight: 600 } }, '0 мин');
    function updateStagesTotal() {
      let s = 0;
      for (const row of stagesArea.children) {
        s += Number(row._min.value) || 0;
      }
      stagesTotalEl.textContent = `${s.toLocaleString('ru-RU')} мин`;
    }
    function addStageRow(stg) {
      const nameI = el('input', { type: 'text', value: stg?.name || '', placeholder: 'Этап (раскрой, сварка, покраска…)', style: { flex: 1, minWidth: '120px' } });
      const minI = el('input', { type: 'number', min: '0', step: '0.1', value: stg ? String(stg.minutes) : '', placeholder: 'мин', style: { width: '90px' } });
      const removeBtn = el('button', { class: 'btn btn-sm', onClick: () => { row.remove(); updateStagesTotal(); } }, '×');
      minI.addEventListener('input', updateStagesTotal);
      const row = el('div', { class: 'plan-stage-row', style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, nameI, minI, removeBtn);
      row._name = nameI; row._min = minI;
      stagesArea.append(row);
    }
    for (const stg of plan.stages || []) addStageRow(stg);
    if (!plan.stages?.length) addStageRow();
    updateStagesTotal();

    const body = el('div', {},
      materialsHint,
      el('div', { class: 'form-row' }, el('label', {}, 'Товар *'), productPickerNode),
      el('div', { class: 'form-row' },
        el('label', {}, 'Этапы изготовления'),
        el('div', {},
          el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' } }, 'Распишите по операциям; общее время труда = сумма этапов.'),
          stagesArea,
          el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' } },
            el('button', { type: 'button', class: 'btn btn-sm', onClick: () => addStageRow() }, '+ Добавить этап'),
            el('span', { style: { fontSize: '13px' } }, 'Итого труда: ', stagesTotalEl),
          ),
        ),
      ),
      el('div', { class: 'form-row' },
        el('label', {}, 'Состав (материалы)'),
        el('div', {},
          itemsArea,
          el('button', { type: 'button', class: 'btn btn-sm', style: { marginTop: '6px' }, onClick: () => addItemRow(), disabled: !materials.length }, '+ Добавить материал'),
        ),
      ),
      canSeeProdCost() && plan.cost_per_unit != null
        ? el('div', { style: { marginTop: '12px', padding: '10px', background: '#f0fdf4', borderRadius: '6px', fontSize: '13px' } },
            `💰 Себестоимость 1 ед: ${plan.cost_per_unit.toLocaleString('ru-RU')} ₽ (материалы ${(plan.materials_total_per_unit || 0).toLocaleString('ru-RU')} + труд ${(plan.labor_total_per_unit || 0).toLocaleString('ru-RU')})`)
        : null,
    );

    await openModal(planId ? `Техкарта` : 'Новая техкарта', body, {
      primaryLabel: planId ? 'Сохранить' : 'Создать',
      onSubmit: async () => {
        const productId = Number(productSel.value);
        if (!productId) { toast('Выберите товар', 'error'); return false; }
        const items = [];
        for (const row of itemsArea.children) {
          const mid = Number(row._sel.value);
          const qty = Number(row._qty.value);
          if (mid && qty > 0) {
            const sizes = [];
            if (row._sizesArea) {
              for (const szRow of row._sizesArea.children) {
                const cnt = parseInt(szRow._cnt?.value, 10);
                const lbl = szRow._lbl?.value?.trim();
                if (cnt > 0 && lbl) sizes.push({ count: cnt, label: lbl });
              }
            }
            items.push({ material_id: mid, qty_per_unit: qty, sizes: sizes.length ? sizes : null });
          }
        }
        const stages = [];
        for (const row of stagesArea.children) {
          const name = row._name.value.trim();
          const minutes = Number(row._min.value) || 0;
          if (name && minutes > 0) stages.push({ name, minutes });
        }
        const totalLabor = stages.reduce((s, x) => s + x.minutes, 0);
        const data = { labor_minutes_per_unit: totalLabor, items, stages };
        if (!planId) data.product_id = productId;
        if (planId) await api.update('processing-plans', planId, data);
        else await api.create('processing-plans', data);
        toast('Сохранено', 'success');
        await reload();
      },
    });
  }

  main.append(el('div', { class: 'toolbar' },
    el('div', { class: 'spacer' }),
    canEditPlans() ? el('button', { class: 'btn btn-primary', onClick: () => openForm(null) }, '+ Новая техкарта') : null,
  ), tableArea);
  reload();
}

// --- Производственные заказы (план выпуска товаров) -------------------------

export async function renderProductionOrders(main) {
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '📅 План производства'),
    el('div', { class: 'page-subtitle' }, 'Сколько и каких товаров делаем за период. Мастер видит свои заказы и вносит факт.'),
  );
  const state = { status: '' };
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.list('production-orders', state);
      renderTable(r.data || []);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message));
    }
  }

  function renderTable(rows) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({ icon: '📅', title: 'Заказов нет', description: 'Создайте план выпуска товара кнопкой выше.' }));
      return;
    }
    const head = el('tr', {},
      el('th', {}, '№'),
      el('th', {}, 'Товар'),
      el('th', {}, 'План'),
      el('th', {}, 'Факт'),
      el('th', {}, 'Период'),
      el('th', {}, 'Мастер'),
      el('th', {}, 'Статус'),
      el('th', { style: { textAlign: 'right' } }, ''),
    );
    const statusMap = {
      draft: ['Черновик', '#e5e7eb', '#374151'],
      approved: ['Утверждён', '#dbeafe', '#1e40af'],
      in_progress: ['В работе', '#fef3c7', '#854d0e'],
      done: ['Готов', '#dcfce7', '#166534'],
      cancelled: ['Отменён', '#fee2e2', '#991b1b'],
    };
    const body = rows.map((r) => {
      const [sl, sb, sf] = statusMap[r.status] || [r.status, '#eee', '#444'];
      return el('tr', { onClick: () => openDetails(r.id) },
        el('td', {}, `#${r.id}`),
        el('td', {}, r.product_name + (r.product_sku ? ` (${r.product_sku})` : '')),
        el('td', {}, String(r.plan_qty)),
        el('td', {}, String(r.fact_qty || 0)),
        el('td', {}, `${fmtDate(r.period_from)} — ${fmtDate(r.period_to)}`),
        el('td', {}, r.foreman_name || '—'),
        el('td', {}, el('span', { style: { background: sb, color: sf, padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 } }, sl)),
        el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
          el('button', { class: 'btn btn-sm', onClick: () => openDetails(r.id) }, 'Открыть'),
        ),
      );
    });
    tableArea.append(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))));
  }

  async function openDetails(id) {
    const order = await api.get('production-orders', id);
    const body = el('div', {},
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Товар'), el('div', {}, order.product_name),
        el('div', { class: 'k' }, 'План / Факт'), el('div', {}, `${order.plan_qty} / ${order.fact_qty}`),
        el('div', { class: 'k' }, 'Период'), el('div', {}, `${fmtDate(order.period_from)} — ${fmtDate(order.period_to)}`),
        el('div', { class: 'k' }, 'Мастер'), el('div', {}, order.foreman_name || '—'),
        el('div', { class: 'k' }, 'Статус'), el('div', {}, order.status),
      ),
      el('h4', { style: { marginTop: '16px' } }, 'Дневная разбивка'),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Дата'), el('th', {}, 'План'), el('th', {}, 'Факт'), el('th', {}, ''))),
          el('tbody', {},
            ...(order.days || []).map((d) => {
              const factI = el('input', { type: 'number', min: '0', step: '1', value: String(d.fact_qty || 0), style: { width: '80px' } });
              const saveBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Записать');
              saveBtn.addEventListener('click', async () => {
                saveBtn.disabled = true;
                try {
                  await api.postProductionFact(order.id, d.day, Number(factI.value) || 0);
                  toast('Факт записан', 'success');
                  // Перечитываем модал.
                  document.querySelector('.modal-backdrop')?.remove();
                  openDetails(order.id);
                } catch (e) { toast(e.message, 'error'); } finally { saveBtn.disabled = false; }
              });
              return el('tr', {},
                el('td', {}, fmtDate(d.day)),
                el('td', {}, String(d.plan_qty)),
                el('td', {}, factI),
                el('td', {}, ['approved', 'in_progress'].includes(order.status) ? saveBtn : el('span', { class: 'muted' }, '—')),
              );
            }),
          ),
        ),
      ),
      order.status === 'draft' && canEditOrders()
        ? el('div', { style: { marginTop: '12px' } },
            el('button', { class: 'btn btn-primary', onClick: async () => {
              await api.approveProductionOrder(order.id);
              toast('План утверждён', 'success');
              document.querySelector('.modal-backdrop')?.remove();
              reload();
            }}, '✅ Утвердить план'))
        : null,
      // Блок «Выполнили N штук» — главная операция мастера/начальника цеха.
      // По нажатию вызывает /execute → списывает материалы по техкарте × N в МС,
      // приходует готовый товар на внутренний склад производства, обновляет fact_qty.
      ['approved', 'in_progress'].includes(order.status)
        ? (() => {
            const qtyI = el('input', { type: 'number', min: '1', step: '1', value: '1', style: { width: '90px' } });
            const btn = el('button', { class: 'btn btn-primary', style: { background: '#15803d' } }, '🏭 Выполнили');
            const statusEl = el('span', { style: { fontSize: '13px', marginLeft: '10px' } });
            btn.addEventListener('click', async () => {
              const qty = Number(qtyI.value);
              if (!qty || qty < 1) { toast('Введите количество', 'error'); return; }
              if (!(await confirm(`Выполнили ${qty} шт «${order.product_name}»? Материалы по техкарте × ${qty} будут списаны со склада в МС, готовый товар оприходован.`))) return;
              btn.disabled = true;
              const orig = btn.textContent;
              btn.textContent = '⏳ Выполняем…';
              try {
                const r = await api.executeProductionOrder(order.id, qty);
                if (r.ms_processing_id) {
                  toast(`✅ Выполнено ${qty} шт. Документ МС создан.`, 'success');
                } else if (r.ms_sync_error) {
                  toast(`✅ Выполнено ${qty} шт. ⚠️ МС: ${r.ms_sync_error}`, 'success');
                } else {
                  toast(`✅ Выполнено ${qty} шт.`, 'success');
                }
                document.querySelector('.modal-backdrop')?.remove();
                reload();
              } catch (e) {
                toast(e.message, 'error');
              } finally {
                btn.disabled = false;
                btn.textContent = orig;
              }
            });
            return el('div', { style: { marginTop: '16px', padding: '12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px' } },
              el('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '🏭 Зафиксировать выпуск'),
              el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                el('label', {}, 'Сколько произвели: '),
                qtyI,
                el('span', {}, ' шт'),
                btn,
                statusEl,
              ),
              el('div', { class: 'hint', style: { fontSize: '12px', marginTop: '8px' } },
                'Списывает материалы (по техкарте × кол-во) и приходует готовый товар в МойСклад. ',
                'Если МС не настроен — фиксируется только в нашей БД.',
              ),
            );
          })()
        : null,
    );
    await openModal(`Производственный заказ #${order.id}`, body, { primaryLabel: null });
  }

  async function openCreate() {
    const productsR = await api.list('products', { limit: 500, active: 'true' });
    const products = productsR.data || [];
    const usersR = await api.list('users', { limit: 200 });
    const users = (usersR.data || []).filter((u) => ['foreman', 'master'].includes(u.role));

    const productSel = el('select', {}, el('option', { value: '' }, '— товар —'),
      ...products.map((p) => el('option', { value: String(p.id) }, p.name + (p.sku ? ` (${p.sku})` : ''))));
    const qtyI = el('input', { type: 'number', min: '1', step: '1' });
    const fromI = el('input', { type: 'date' });
    const toI = el('input', { type: 'date' });
    const foremanSel = el('select', {}, el('option', { value: '' }, '— не назначен —'),
      ...users.map((u) => el('option', { value: String(u.id) }, `${u.name} (${tr('role', u.role)})`)));
    const notesI = el('textarea', { rows: '2' });

    const body = el('div', {},
      el('div', { class: 'form-row' }, el('label', {}, 'Товар *'), productSel),
      el('div', { class: 'form-row' }, el('label', {}, 'План, шт *'), qtyI),
      el('div', { class: 'form-row' }, el('label', {}, 'Период с *'), fromI),
      el('div', { class: 'form-row' }, el('label', {}, 'Период по *'), toI),
      el('div', { class: 'form-row' }, el('label', {}, 'Мастер / начальник цеха'), foremanSel),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    );
    await openModal('Новый производственный заказ', body, {
      primaryLabel: 'Создать',
      onSubmit: async () => {
        if (!productSel.value || !qtyI.value || !fromI.value || !toI.value) {
          toast('Заполните товар, план, даты', 'error');
          return false;
        }
        await api.create('production-orders', {
          product_id: Number(productSel.value),
          plan_qty: Number(qtyI.value),
          period_from: fromI.value,
          period_to: toI.value,
          foreman_id: foremanSel.value ? Number(foremanSel.value) : null,
          notes: notesI.value || null,
        });
        toast('Создан', 'success');
        await reload();
      },
    });
  }

  main.append(el('div', { class: 'toolbar' },
    el('div', { class: 'spacer' }),
    canEditOrders() ? el('button', { class: 'btn btn-primary', onClick: openCreate }, '+ Новый план') : null,
  ), tableArea);
  reload();
}

// --- Подряды ------------------------------------------------------------------

const CONTRACT_STAGES = [
  { code: 'measure', label: 'Замер', icon: '📐' },
  { code: 'cut', label: 'Раскрой', icon: '✂' },
  { code: 'weld', label: 'Сварка', icon: '🔥' },
  { code: 'paint', label: 'Покраска', icon: '🎨' },
  { code: 'ship', label: 'Отгрузка', icon: '🚚' },
];

export async function renderContracts(main) {
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '📋 Подряды'),
    el('div', { class: 'page-subtitle' }, 'Клиентские заказы на изготовление: замер → раскрой → сварка → покраска → отгрузка. Маржа = оплата − (материалы + труд + прочие).'),
  );
  const state = { status: '' };
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const r = await api.list('contracts', state);
      renderList(r.data || []);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'card error' }, e.message));
    }
  }

  function renderList(rows) {
    clear(tableArea);
    if (!rows.length) {
      tableArea.append(emptyState({ icon: '📋', title: 'Подрядов пока нет', description: 'Создайте первый подряд кнопкой выше.' }));
      return;
    }
    const showMoney = ['admin', 'director_prod'].includes(prodRole());
    const head = el('tr', {},
      el('th', {}, '№'),
      el('th', {}, 'Клиент'),
      showMoney ? el('th', {}, 'Сумма') : null,
      showMoney ? el('th', {}, 'Оплачено') : null,
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Статус'),
      el('th', {}, 'Этапы'),
      el('th', { style: { textAlign: 'right' } }, ''),
    );
    const body = rows.map((c) => el('tr', { onClick: () => openContract(c.id) },
      el('td', {}, `#${c.id}`),
      el('td', {}, `${c.client_name}${c.client_company ? ' / ' + c.client_company : ''}`),
      showMoney ? el('td', {}, fmtMoney(c.total_amount, c.currency || 'RUB')) : null,
      showMoney ? el('td', {}, fmtMoney(c.paid_amount, c.currency || 'RUB')) : null,
      el('td', {}, c.manager_name || '—'),
      el('td', {}, c.status),
      el('td', { style: { fontSize: '12px' } }, ''), // плашки этапов покажем в детали
      el('td', { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
        el('button', { class: 'btn btn-sm', onClick: () => openContract(c.id) }, 'Открыть'),
      ),
    ));
    tableArea.append(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, head), el('tbody', {}, ...body))));
  }

  async function openContract(id) {
    const c = await api.get('contracts', id);
    const showMoney = c.cost_total != null;
    const stagesRow = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } });
    for (const def of CONTRACT_STAGES) {
      const stg = (c.stages || []).find((s) => s.stage === def.code) || { stage: def.code };
      const closed = !!stg.fact_date;
      const chip = el('div', {
        class: 'contract-stage-chip',
        style: { padding: '6px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
          background: closed ? '#dcfce7' : '#f3f4f6', color: closed ? '#166534' : '#374151',
          border: '1px solid ' + (closed ? '#86efac' : '#d1d5db') },
        onClick: async () => {
          if (closed) return;
          if (!(await confirm(`Закрыть этап «${def.label}»?`))) return;
          try {
            await api.updateContractStage(c.id, def.code, { close: true });
            toast('Этап закрыт', 'success');
            document.querySelector('.modal-backdrop')?.remove();
            openContract(c.id);
          } catch (e) { toast(e.message, 'error'); }
        },
      },
        `${def.icon} ${def.label}${closed ? ' ✓ ' + fmtDate(stg.fact_date) : ''}`,
        stg.plan_date && !closed ? el('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, 'план: ' + fmtDate(stg.plan_date)) : null,
      );
      stagesRow.append(chip);
    }
    const body = el('div', {},
      el('div', { class: 'detail-grid' },
        el('div', { class: 'k' }, 'Клиент'), el('div', {}, c.client_name),
        c.client_company ? el('div', { class: 'k' }, 'Компания') : null, c.client_company ? el('div', {}, c.client_company) : null,
        c.client_phone ? el('div', { class: 'k' }, 'Телефон') : null, c.client_phone ? el('div', {}, c.client_phone) : null,
        el('div', { class: 'k' }, 'Менеджер'), el('div', {}, c.manager_name || '—'),
        showMoney ? el('div', { class: 'k' }, 'Сумма / Оплачено') : null,
        showMoney ? el('div', {}, `${fmtMoney(c.total_amount, c.currency)} / ${fmtMoney(c.paid_amount, c.currency)}`) : null,
        showMoney ? el('div', { class: 'k' }, 'Себестоимость') : null,
        showMoney ? el('div', {}, fmtMoney(c.cost_total || 0, c.currency)) : null,
        showMoney ? el('div', { class: 'k' }, 'Маржа') : null,
        showMoney ? el('div', { style: { color: c.margin >= 0 ? '#15803d' : '#b91c1c', fontWeight: 600 } }, fmtMoney(c.margin || 0, c.currency)) : null,
      ),
      c.description ? el('p', { style: { marginTop: '10px' } }, c.description) : null,
      el('h4', { style: { marginTop: '16px' } }, 'Этапы'),
      el('div', { class: 'hint', style: { fontSize: '12px' } }, 'Тапните на этап чтобы закрыть. Закрытые отмечены ✓.'),
      stagesRow,
      showMoney ? renderContractMoneyBlock(c) : null,
    );
    await openModal(`Подряд #${c.id}: ${c.client_name}`, body, { primaryLabel: null, size: 'lg' });
  }

  function renderContractMoneyBlock(c) {
    const wrap = el('div', { style: { marginTop: '16px' } });
    wrap.append(el('h4', {}, 'Затраты'));
    const grid = el('div', { class: 'detail-grid' });
    grid.append(
      el('div', { class: 'k' }, 'Материалы'),
      el('div', {}, (c.materials || []).length ? `${c.materials.length} списаний` : '—'),
      el('div', { class: 'k' }, 'Труд'),
      el('div', {}, (c.labor || []).length ? `${c.labor.length} записей` : '—'),
      el('div', { class: 'k' }, 'Прочее'),
      el('div', {}, (c.other_expenses || []).length ? `${c.other_expenses.length} расходов` : '—'),
    );
    wrap.append(grid);
    // Кнопки добавления — для admin/director_prod/foreman.
    if (['admin', 'director_prod', 'foreman'].includes(prodRole())) {
      wrap.append(el('div', { style: { marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        el('button', { class: 'btn btn-sm', onClick: () => addMaterialDialog(c.id) }, '+ Списать материал'),
        el('button', { class: 'btn btn-sm', onClick: () => addLaborDialog(c.id) }, '+ Записать труд'),
        ['admin', 'director_prod'].includes(prodRole())
          ? el('button', { class: 'btn btn-sm', onClick: () => addOtherDialog(c.id) }, '+ Прочий расход')
          : null,
      ));
    }
    return wrap;
  }

  async function addMaterialDialog(contractId) {
    const matsR = await api.list('materials', { active: 'true' });
    const mats = matsR.data || [];
    const matSel = el('select', {}, el('option', { value: '' }, '— материал —'),
      ...mats.map((m) => el('option', { value: String(m.id), 'data-cost': String(m.cost_price || 0) }, `${m.name}${m.sku ? ' (' + m.sku + ')' : ''}`)));
    const qtyI = el('input', { type: 'number', min: '0.001', step: '0.001' });
    const priceI = el('input', { type: 'number', min: '0', step: '0.01' });
    matSel.addEventListener('change', () => {
      const opt = matSel.options[matSel.selectedIndex];
      priceI.value = opt?.dataset?.cost || '';
    });
    const noteI = el('input', { type: 'text' });
    await openModal('Списать материал', el('div', {},
      el('div', { class: 'form-row' }, el('label', {}, 'Материал'), matSel),
      el('div', { class: 'form-row' }, el('label', {}, 'Количество'), qtyI),
      el('div', { class: 'form-row' }, el('label', {}, 'Цена за ед'), priceI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметка'), noteI),
    ), {
      primaryLabel: 'Списать',
      onSubmit: async () => {
        if (!matSel.value || !qtyI.value) { toast('Заполните материал и количество', 'error'); return false; }
        await api.consumeContractMaterial(contractId, {
          material_id: Number(matSel.value), qty: Number(qtyI.value),
          unit_price: Number(priceI.value) || 0, note: noteI.value || null,
        });
        toast('Списано', 'success');
        document.querySelector('.modal-backdrop')?.remove();
        openContract(contractId);
      },
    });
  }
  async function addLaborDialog(contractId) {
    const minutesI = el('input', { type: 'number', min: '1', step: '1' });
    const rateI = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'оставьте пусто — возьмём из настроек' });
    const noteI = el('input', { type: 'text' });
    await openModal('Записать труд', el('div', {},
      el('div', { class: 'form-row' }, el('label', {}, 'Минут'), minutesI),
      el('div', { class: 'form-row' }, el('label', {}, 'Ставка ₽/мин'), rateI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметка'), noteI),
    ), {
      primaryLabel: 'Записать',
      onSubmit: async () => {
        if (!minutesI.value) { toast('Введите минуты', 'error'); return false; }
        const body = { minutes: Number(minutesI.value), note: noteI.value || null };
        if (rateI.value) body.rate_per_minute = Number(rateI.value);
        await api.logContractLabor(contractId, body);
        toast('Записано', 'success');
        document.querySelector('.modal-backdrop')?.remove();
        openContract(contractId);
      },
    });
  }
  async function addOtherDialog(contractId) {
    const amountI = el('input', { type: 'number', min: '0', step: '0.01' });
    const kindI = el('input', { type: 'text', placeholder: 'доставка, услуги, …' });
    const noteI = el('input', { type: 'text' });
    await openModal('Прочий расход', el('div', {},
      el('div', { class: 'form-row' }, el('label', {}, 'Сумма ₽'), amountI),
      el('div', { class: 'form-row' }, el('label', {}, 'Тип'), kindI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметка'), noteI),
    ), {
      primaryLabel: 'Добавить',
      onSubmit: async () => {
        if (!amountI.value) { toast('Введите сумму', 'error'); return false; }
        await api.addContractOtherExpense(contractId, { amount: Number(amountI.value), kind: kindI.value || null, note: noteI.value || null });
        toast('Добавлено', 'success');
        document.querySelector('.modal-backdrop')?.remove();
        openContract(contractId);
      },
    });
  }

  async function openCreate() {
    const [usersR, projectsR] = await Promise.all([
      api.list('users', { limit: 200 }),
      api.projectsList(true),
    ]);
    const users = (usersR.data || []).filter((u) => ['foreman', 'master', 'manager', 'sales'].includes(u.role));
    const projects = projectsR.data || [];
    const fields = [
      { name: 'client_name', label: 'Клиент *', required: true },
      { name: 'client_company', label: 'Компания' },
      { name: 'client_phone', label: 'Телефон' },
      { name: 'total_amount', label: 'Сумма ₽', type: 'number' },
      { name: 'description', label: 'Что делаем', type: 'textarea' },
    ];
    const { node, getValues } = buildForm(fields, {});
    const mgrSel = el('select', {}, el('option', { value: '' }, '— не выбран —'),
      ...users.map((u) => el('option', { value: String(u.id) }, `${u.name} (${tr('role', u.role)})`)));
    // Привязка к проекту — если проект помечен как производственный, доход
    // этого подряда попадёт в P&L производства.
    const projSel = el('select', {}, el('option', { value: '' }, '— без проекта —'),
      ...projects.map((p) => el('option', { value: String(p.id) }, `${p.name}${p.is_production ? ' 🏭' : ''}`)));
    node.append(
      el('div', { class: 'form-row' }, el('label', {}, 'Ответственный'), mgrSel),
      el('div', { class: 'form-row' }, el('label', {}, 'Проект'), projSel),
    );

    await openModal('Новый подряд', node, {
      primaryLabel: 'Создать',
      onSubmit: async () => {
        const data = getValues();
        if (!data.client_name) { toast('Имя клиента обязательно', 'error'); return false; }
        if (data.total_amount) data.total_amount = Number(data.total_amount);
        if (mgrSel.value) data.manager_id = Number(mgrSel.value);
        if (projSel.value) data.project_id = Number(projSel.value);
        await api.create('contracts', data);
        toast('Подряд создан', 'success');
        await reload();
      },
    });
  }

  main.append(el('div', { class: 'toolbar' },
    el('div', { class: 'spacer' }),
    canEditContracts() ? el('button', { class: 'btn btn-primary', onClick: openCreate }, '+ Новый подряд') : null,
  ), tableArea);
  reload();
}

// --- 💰 Доходность производства (P&L) ---------------------------------------

export async function renderProductionPL(main) {
  main.innerHTML = '';
  main.append(
    el('h1', { class: 'page-title' }, '💰 Доходность производства'),
    el('div', { class: 'page-subtitle' },
      'Доход = подтверждённые платежи по заказам и оплаты подрядов с производственным проектом. ',
      'Расход = материалы/труд/прочее по подрядам производства + ручные расходы за период.',
    ),
  );

  // Период по умолчанию — текущий месяц.
  const today = new Date();
  const monthFirst = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const state = { from: monthFirst, to: todayStr };

  const fromI = el('input', { type: 'date', value: state.from });
  const toI = el('input', { type: 'date', value: state.to });
  const reloadBtn = el('button', { class: 'btn btn-primary' }, '↻ Пересчитать');

  const body = el('div');
  function setBusy(v) {
    reloadBtn.disabled = v;
    reloadBtn.textContent = v ? '⏳ Считаю…' : '↻ Пересчитать';
  }

  async function reload() {
    state.from = fromI.value || monthFirst;
    state.to = toI.value || todayStr;
    setBusy(true);
    clear(body);
    body.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const [pl, exp, projectsAll] = await Promise.all([
        api.productionPL(state.from, state.to),
        api.productionExpenses(state.from, state.to),
        api.projectsList(false),
      ]);
      renderPL(pl, exp, (projectsAll.data || []));
    } catch (e) {
      clear(body);
      body.append(el('div', { class: 'card error' }, e.message || 'Ошибка'));
    } finally {
      setBusy(false);
    }
  }

  // Карточка управления производственными проектами — вверху страницы.
  // Чекбокс «🏭 Производственный» на любом проекте — клик меняет флаг.
  function renderProjectsManager(allProjects) {
    const card = el('div', { class: 'card', style: { marginBottom: '12px' } },
      el('h3', { style: { marginTop: 0 } }, '🏷️ Производственные проекты'),
      el('div', { class: 'page-subtitle' },
        'Отметьте проекты, которые относятся к производству (например ЧПБ — полимерная краска). ',
        'Доход с их сделок/заказов/подрядов попадает в P&L выше.'),
    );
    if (!allProjects.length) {
      card.append(el('p', { class: 'muted' }, 'Проектов нет. Создайте их в Настройках → Проекты.'));
      return card;
    }
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' } });
    for (const p of allProjects) {
      const cb = el('input', { type: 'checkbox', checked: !!p.is_production });
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          await api.projectUpdate(p.id, { is_production: cb.checked });
          toast(`«${p.name}» ${cb.checked ? 'теперь производственный' : 'снят с производства'}`, 'success');
          reload();
        } catch (e) {
          cb.checked = !cb.checked;
          toast(e.message, 'error');
        } finally { cb.disabled = false; }
      });
      list.append(
        el('label', { style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 8px', background: '#f9fafb', borderRadius: '6px', cursor: 'pointer' } },
          cb,
          el('span', { class: 'project-sticker', style: { background: p.color || '#6366f1' } }, p.name),
          p.is_production ? el('span', { style: { fontSize: '12px', color: '#15803d', fontWeight: 600 } }, '🏭 в производстве') : null,
          !p.active ? el('span', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, '(архив)') : null,
        ),
      );
    }
    card.append(list);
    return card;
  }

  function statTile(title, value, color) {
    return el('div', {
      style: {
        flex: 1, minWidth: '180px', padding: '16px',
        background: '#fff', border: '1px solid var(--border)', borderRadius: '8px',
      },
    },
      el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, title),
      el('div', { style: { fontSize: '22px', fontWeight: 700, marginTop: '4px', color } }, fmtMoney(value, 'RUB')),
    );
  }

  function renderPL(pl, exp, allProjects) {
    clear(body);

    // Случай 1: нет производственных проектов — показываем менеджер проектов
    // прямо тут, чтобы можно было отметить нужные одним кликом.
    if (!pl.production_projects?.length) {
      body.append(
        el('div', { class: 'card', style: { marginBottom: '12px', background: '#fffbeb', borderLeft: '4px solid #f59e0b' } },
          el('div', { style: { fontWeight: 600 } }, '🏭 Производственные проекты не выбраны'),
          el('p', { style: { marginTop: '6px', fontSize: '13px' } },
            'Отметьте ниже проекты, которые относятся к производству — и тут появятся доходы/расходы по ним.'),
        ),
        renderProjectsManager(allProjects),
      );
      return;
    }

    // KPI сверху: доход, расход, прибыль.
    body.append(
      el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' } },
        statTile('Доход за период', pl.income.total, '#15803d'),
        statTile('Расход за период', pl.expense.total, '#b91c1c'),
        statTile('Прибыль', pl.profit, pl.profit >= 0 ? '#15803d' : '#b91c1c'),
      ),
      renderProjectsManager(allProjects),
    );

    // Доходы по источникам и по проектам.
    body.append(
      el('div', { class: 'card', style: { marginBottom: '12px' } },
        el('h3', { style: { marginTop: 0 } }, '📈 Доходы'),
        el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' } },
          el('div', {},
            el('div', { class: 'k' }, 'Выигранные сделки'),
            el('div', { style: { fontWeight: 600 } }, fmtMoney(pl.income.by_source.deals || 0, 'RUB')),
          ),
          el('div', {},
            el('div', { class: 'k' }, 'Заказы (платежи)'),
            el('div', { style: { fontWeight: 600 } }, fmtMoney(pl.income.by_source.orders, 'RUB')),
          ),
          el('div', {},
            el('div', { class: 'k' }, 'Подряды (paid)'),
            el('div', { style: { fontWeight: 600 } }, fmtMoney(pl.income.by_source.contracts, 'RUB')),
          ),
        ),
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Проект'), el('th', { style: { textAlign: 'right' } }, 'Доход'))),
          el('tbody', {},
            ...pl.income.by_project.map((p) => el('tr', {},
              el('td', {}, el('span', { class: 'project-sticker', style: { background: p.color } }, p.name)),
              el('td', { style: { textAlign: 'right', fontWeight: 600 } }, fmtMoney(p.income, 'RUB')),
            )),
          ),
        ),
      ),
    );

    // Расходы.
    body.append(
      el('div', { class: 'card', style: { marginBottom: '12px' } },
        el('h3', { style: { marginTop: 0 } }, '📉 Расходы'),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' } },
          el('div', {},
            el('div', { class: 'k' }, 'По подрядам (материалы/труд/прочее)'),
            el('div', { style: { fontWeight: 600 } }, fmtMoney(pl.expense.by_source.contract_costs, 'RUB')),
          ),
          el('div', {},
            el('div', { class: 'k' }, 'Ручные расходы'),
            el('div', { style: { fontWeight: 600 } }, fmtMoney(pl.expense.by_source.manual, 'RUB')),
          ),
        ),
      ),
    );

    // Ручные расходы — список + форма добавления.
    const expBlock = el('div', { class: 'card' },
      el('h3', { style: { marginTop: 0 } }, '🧾 Ручные расходы'),
      el('div', { class: 'page-subtitle' }, 'ФОТ, аренда, оборудование, налоги, прочее — то, что не списывается через подряд.'),
    );

    const addAmountI = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Сумма ₽' });
    const addCategoryI = el('input', { type: 'text', placeholder: 'Категория (ФОТ, аренда, …)' });
    const addDescI = el('input', { type: 'text', placeholder: 'Описание (опц.)' });
    const addDateI = el('input', { type: 'date', value: todayStr });
    const addBtn = el('button', { class: 'btn btn-primary' }, '+ Добавить расход');
    addBtn.addEventListener('click', async () => {
      const amount = Number(addAmountI.value);
      if (!amount) { toast('Введите сумму', 'error'); return; }
      addBtn.disabled = true;
      try {
        await api.createProductionExpense({
          amount,
          category: addCategoryI.value || null,
          description: addDescI.value || null,
          spent_at: addDateI.value || null,
        });
        toast('Добавлено', 'success');
        addAmountI.value = ''; addCategoryI.value = ''; addDescI.value = '';
        reload();
      } catch (e) { toast(e.message, 'error'); } finally { addBtn.disabled = false; }
    });
    expBlock.append(
      el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px', marginBottom: '12px' } },
        addDateI, addAmountI, addCategoryI, addDescI, addBtn,
      ),
    );

    if (!exp.data?.length) {
      expBlock.append(el('div', { class: 'muted', style: { padding: '12px' } }, 'За период расходов не было.'));
    } else {
      expBlock.append(
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Дата'),
            el('th', {}, 'Сумма'),
            el('th', {}, 'Категория'),
            el('th', {}, 'Описание'),
            el('th', {}, 'Кто внёс'),
            el('th', {}, ''),
          )),
          el('tbody', {},
            ...exp.data.map((r) => el('tr', {},
              el('td', {}, fmtDate(r.spent_at)),
              el('td', { style: { fontWeight: 600 } }, fmtMoney(r.amount, 'RUB')),
              el('td', {}, r.category || '—'),
              el('td', {}, r.description || '—'),
              el('td', {}, r.recorded_by_name || '—'),
              el('td', { style: { textAlign: 'right' } },
                el('button', { class: 'btn btn-sm btn-danger', onClick: async () => {
                  if (!(await confirm('Удалить запись расхода?'))) return;
                  try { await api.deleteProductionExpense(r.id); toast('Удалено', 'success'); reload(); }
                  catch (e) { toast(e.message, 'error'); }
                }}, '🗑'),
              ),
            )),
          ),
        ),
        el('div', { style: { marginTop: '8px', textAlign: 'right', fontSize: '13px' } },
          'Итого за период: ', el('b', {}, fmtMoney(exp.total || 0, 'RUB')),
        ),
      );
    }

    body.append(expBlock);
  }

  reloadBtn.addEventListener('click', reload);
  fromI.addEventListener('change', reload);
  toI.addEventListener('change', reload);

  main.append(
    el('div', { class: 'toolbar', style: { gap: '8px' } },
      el('label', {}, 'С '), fromI,
      el('label', {}, 'по '), toI,
      reloadBtn,
    ),
    body,
  );
  reload();
}

// Секция «Производство» в Настройках → Интеграции: внутренний склад
// производства (из МС) и ставка труда ₽/мин. Видна admin и director_prod.
async function renderProductionSettingsSection(area) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  if (!['admin', 'director_prod'].includes(me.role)) return;
  area.innerHTML = '';
  area.append(
    el('div', { class: 'section-header' }, el('h2', {}, '🏭 Производство')),
    el('p', { class: 'help-banner' },
      'Внутренний склад — куда оприходовать готовые изделия и где хранить материалы в МойСклад. ',
      'Ставка труда — стоимость минуты работы для расчёта себестоимости (минуты × ставка).'),
  );
  const loadingEl = el('div', { class: 'loading' }, 'Загрузка…');
  area.append(loadingEl);
  try {
    const [settings, stores] = await Promise.all([
      api.productionSettings(),
      api.msStores(false).catch(() => ({ stores: [] })),
    ]);
    loadingEl.remove();

    const whSel = el('select', { style: { minWidth: '260px' } },
      el('option', { value: '' }, '— не выбран —'),
      ...((stores.stores || []).map((s) => el('option', {
        value: s.id, selected: settings.internal_warehouse?.id === s.id, 'data-name': s.name,
      }, s.name))),
    );
    const refreshBtn = el('button', { class: 'btn btn-sm', title: 'Обновить список из МС' }, '↻');
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      try {
        const r = await api.msStores(true);
        whSel.innerHTML = '';
        whSel.append(el('option', { value: '' }, '— не выбран —'));
        for (const s of r.stores || []) {
          whSel.append(el('option', { value: s.id, 'data-name': s.name, selected: settings.internal_warehouse?.id === s.id }, s.name));
        }
        toast('Список складов обновлён', 'success');
      } catch (e) { toast(e.message, 'error'); } finally { refreshBtn.disabled = false; }
    });

    const rateI = el('input', { type: 'number', min: '0', step: '0.01', value: settings.labor_rate_per_minute != null ? String(settings.labor_rate_per_minute) : '', style: { width: '130px' } });
    const saveBtn = el('button', { class: 'btn btn-primary' }, '💾 Сохранить настройки');
    const status = el('span', { style: { marginLeft: '8px' } });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true; status.textContent = '';
      try {
        const opt = whSel.options[whSel.selectedIndex];
        const internal_warehouse = whSel.value ? { id: whSel.value, name: opt?.dataset?.name || whSel.value } : null;
        const rateVal = rateI.value ? Number(rateI.value) : null;
        await api.updateProductionSettings({ internal_warehouse, labor_rate_per_minute: rateVal });
        status.style.color = '#15803d'; status.textContent = '✅ Сохранено';
        toast('Настройки производства сохранены', 'success');
      } catch (e) { status.style.color = '#b91c1c'; status.textContent = '❌ ' + e.message; }
      finally { saveBtn.disabled = false; }
    });

    area.append(
      el('div', { class: 'card' },
        el('div', { class: 'form-row' },
          el('label', {}, 'Внутренний склад производства'),
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
            whSel, refreshBtn,
          ),
        ),
        el('div', { class: 'form-row' },
          el('label', {}, 'Ставка труда (₽/мин)'),
          el('div', {}, rateI, el('span', { style: { marginLeft: '8px', fontSize: '12px', color: 'var(--text-muted)' } }, 'Например: 5 ₽/мин = 300 ₽/час')),
        ),
        el('div', { style: { marginTop: '12px' } }, saveBtn, status),
      ),
    );
  } catch (e) {
    loadingEl.remove();
    area.append(el('div', { class: 'card error' }, 'Ошибка: ' + (e.message || 'не удалось загрузить')));
  }
}

// ============================================================
// ТЕСТОВАЯ ЗОНА «Поставки → Доставки» (ТЗ 18.07.2026, Phase 1 — изоляция)
// Всё под фиче-флагом: пока владелец не включит зону, обычные менеджеры её не
// видят и не могут в ней работать — боевой поток не затрагивается.
// ============================================================
export async function renderSupplyDelivery(main) {
  const wrap = el('div', { class: 'page' });
  main.append(wrap);

  wrap.append(el('div', {
    class: 'notice-banner notice-warning',
    style: { marginBottom: '16px' },
  }, '🧪 ТЕСТОВАЯ ЗОНА «Поставки → Доставки». Модуль в разработке — не для рабочих операций. Пока идёт тестирование, обычные менеджеры сюда не заходят.'));

  let flag;
  try {
    flag = await api.supplyDeliveryFlag();
  } catch (e) {
    wrap.append(el('div', { class: 'card error' }, 'Ошибка доступа к зоне: ' + (e.message || '')));
    return;
  }

  if (flag.is_admin) wrap.append(renderSdAdminPanel());

  if (flag.can_operate) {
    // Всё свёрнуто по умолчанию + ленивая загрузка: содержимое секции строится и
    // тянет данные ТОЛЬКО при раскрытии — страница открывается быстро, без кучи запросов.
    if (flag.is_admin) wrap.append(sdCollapsible('🏷️ Каналы (юрлица + API-ключи)', renderSdChannelsCard));
    wrap.append(sdCollapsible('📦 Поставки', renderSdSuppliesCard));
    wrap.append(sdCollapsible('🚚 Доставки', renderSdDeliveriesCard));
    wrap.append(sdCollapsible('🧩 Книга сетов', renderSdSetsCard));
    wrap.append(sdCollapsible('🔗 Сопоставление с каналом (matching)', () => renderSdChannelMapCard(flag.is_admin)));
    wrap.append(sdCollapsible('📐 Сверка габаритов (МП ⇄ сет)', renderSdSizeMapCard));
    wrap.append(sdCollapsible('💰 Финансы — доставки', renderSdFinanceCard));
    wrap.append(sdCollapsible('📚 Справочники (офис)', renderSdDirectories));
  } else if (!flag.is_admin) {
    wrap.append(el('div', { class: 'card' }, 'Зона выключена. Обратитесь к администратору, чтобы получить тестовый доступ.'));
  }
}

// Свёрнутая по умолчанию секция с ленивой загрузкой: buildFn зовётся только при
// первом раскрытии (иначе страница тест-зоны тянет всё сразу и тормозит).
function sdCollapsible(title, buildFn) {
  let built = false;
  const body = el('div', { style: { display: 'none' } });
  const chevron = el('span', { style: { marginRight: '8px', display: 'inline-block', width: '12px' } }, '▸');
  const header = el('div', {
    style: {
      display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: '600', fontSize: '15px',
      padding: '10px 12px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', marginBottom: '8px', userSelect: 'none',
    },
    onClick: () => {
      const show = body.style.display === 'none';
      body.style.display = show ? '' : 'none';
      chevron.textContent = show ? '▾' : '▸';
      if (show && !built) {
        built = true;
        try { body.append(buildFn()); } catch (e) { body.append(el('div', { class: 'card error' }, e.message || 'ошибка')); }
      }
    },
  }, chevron, el('span', {}, title));
  return el('div', { style: { marginBottom: '8px' } }, header, body);
}

// Справочники модуля (Phase 2a). Всё внутри тест-зоны, под гейтом.
function renderSdDirectories() {
  const wrap = el('div', {});
  wrap.append(sdTariffsCard());
  // Вознаграждение склада теперь задаётся НА КАЖДОМ СЕТЕ (Книга сетов), а не глобально —
  // старый глобальный справочник вознаграждения убран.
  wrap.append(sdThresholdsCard());
  return wrap;
}

const SD_REWARD_UNITS = { per_order: 'за заказ', per_item: 'за позицию', per_hour: 'за час' };

function sdTariffsCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('h4', {}, 'Тарифы упаковки'),
    el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdEditTariff(null, reload) }, '+ Тариф')));
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Тип'), el('th', {}, 'Ед. изм.'),
      el('th', {}, 'Стоимость, ₽'), el('th', {}, ''))), tbody));
  async function reload() {
    tbody.textContent = '';
    let rows = [];
    try { rows = await api.sdTariffs(); } catch (e) { toast(e.message, 'error'); }
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '4' }, 'Пока нет тарифов'))); return; }
    for (const t of rows) {
      tbody.append(el('tr', {},
        el('td', {}, t.name),
        el('td', {}, t.unit || 'шт'),
        el('td', {}, String(t.cost)),
        el('td', { style: { whiteSpace: 'nowrap' } },
          el('button', { class: 'btn btn-sm', onClick: () => sdTariffHistory(t) }, 'История'),
          el('button', { class: 'btn btn-sm', style: { marginLeft: '4px' }, onClick: () => sdEditTariff(t, reload) }, '✏'),
          el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
            if (!(await confirm(`Удалить тариф «${t.name}»?`))) return;
            try { await api.sdDeleteTariff(t.id); reload(); } catch (e) { toast(e.message, 'error'); }
          } }, '🗑'))));
    }
  }
  reload();
  return card;
}

async function sdEditTariff(tariff, onSaved) {
  const nameI = el('input', { type: 'text', value: tariff?.name || '' });
  const unitI = el('input', { type: 'text', value: tariff?.unit || 'шт', placeholder: 'шт / м / рулон…' });
  const costI = el('input', { type: 'number', step: 'any', min: '0', value: tariff?.cost ?? '' });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Тип упаковки'), nameI),
    el('div', { class: 'form-row' }, el('label', {}, 'Единица измерения'), unitI),
    el('div', { class: 'form-row' }, el('label', {}, 'Стоимость за единицу, ₽'), costI));
  await openModal(tariff ? 'Изменить тариф' : 'Новый тариф', body, {
    primaryLabel: 'Сохранить',
    onSubmit: async () => {
      const payload = { name: nameI.value.trim(), unit: unitI.value.trim() || 'шт', cost: Number(costI.value) || 0 };
      if (!payload.name) { toast('Укажите тип упаковки', 'error'); return false; }
      try {
        if (tariff) await api.sdUpdateTariff(tariff.id, payload);
        else await api.sdCreateTariff(payload);
        toast('Тариф сохранён', 'success');
        onSaved?.();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

async function sdTariffHistory(tariff) {
  let rows = [];
  try { rows = await api.sdTariffHistory(tariff.id); } catch (e) { toast(e.message, 'error'); return; }
  const body = el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Когда'), el('th', {}, 'Стоимость, ₽'))),
    el('tbody', {}, ...(rows.length ? rows.map((h) => el('tr', {},
      el('td', {}, fmtDateTime(h.changed_at)), el('td', {}, String(h.cost)),
    )) : [el('tr', {}, el('td', { colspan: '2' }, 'Нет истории'))])));
  await openModal(`История цены тарифа «${tariff.name}»`, body);
}

function sdRewardCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('h4', {}, 'Вознаграждение склада'));
  const body = el('div', {}, 'Загрузка…');
  card.append(body);
  (async () => {
    let r;
    try { r = await api.sdReward(); } catch (e) { body.textContent = e.message; return; }
    body.textContent = '';
    const amountI = el('input', { type: 'number', step: 'any', min: '0', value: r.amount ?? 0, style: { width: '140px' } });
    const unitS = el('select', {}, ...Object.entries(SD_REWARD_UNITS).map(([v, l]) =>
      el('option', { value: v, ...(v === r.unit ? { selected: 'selected' } : {}) }, l)));
    const status = el('span', { style: { marginLeft: '10px' } });
    const saveBtn = el('button', { class: 'btn btn-primary', onClick: async () => {
      status.textContent = 'Сохраняю…';
      try {
        await api.sdSaveReward({ amount: Number(amountI.value) || 0, unit: unitS.value });
        status.textContent = 'Сохранено'; toast('Вознаграждение сохранено', 'success');
      } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
    } }, 'Сохранить');
    body.append(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', {}, 'Ставка, ₽'), amountI, unitS, saveBtn, status));
  })();
  return card;
}

function sdThresholdsCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('h4', {}, 'Пороги остатков при поставке'),
    el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdEditThreshold(null, reload) }, '+ По SKU')));
  const info = el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'Строка «default» — глобальный порог. Режим: предупреждение или жёсткий запрет при поставке ниже порога.');
  card.append(info);
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'SKU'), el('th', {}, 'Порог'), el('th', {}, 'Режим'), el('th', {}, ''))), tbody));
  async function reload() {
    tbody.textContent = '';
    let rows = [];
    try { rows = await api.sdThresholds(); } catch (e) { toast(e.message, 'error'); }
    const hasDefault = rows.some((r) => r.sku === 'default');
    if (!hasDefault) {
      tbody.append(el('tr', {}, el('td', {}, el('em', {}, 'default (не задан)')), el('td', {}, '—'), el('td', {}, '—'),
        el('td', {}, el('button', { class: 'btn btn-sm', onClick: () => sdEditThreshold({ sku: 'default' }, reload) }, 'Задать'))));
    }
    for (const r of rows) {
      tbody.append(el('tr', {},
        el('td', {}, r.sku),
        el('td', {}, String(r.threshold)),
        el('td', {}, r.mode === 'block' ? 'жёсткий запрет' : 'предупреждение'),
        el('td', { style: { whiteSpace: 'nowrap' } },
          el('button', { class: 'btn btn-sm', onClick: () => sdEditThreshold(r, reload) }, '✏'),
          r.sku === 'default' ? null : el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
            if (!(await confirm(`Удалить порог для «${r.sku}»?`))) return;
            try { await api.sdDeleteThreshold(r.sku); reload(); } catch (e) { toast(e.message, 'error'); }
          } }, '🗑'))));
    }
  }
  reload();
  return card;
}

async function sdEditThreshold(row, onSaved) {
  const isDefault = row?.sku === 'default';
  const skuI = el('input', { type: 'text', value: row?.sku || '', ...(row ? { disabled: 'disabled' } : {}) });
  const thrI = el('input', { type: 'number', min: '0', step: '1', value: row?.threshold ?? 0 });
  const modeS = el('select', {},
    el('option', { value: 'warn', ...(row?.mode !== 'block' ? { selected: 'selected' } : {}) }, 'Предупреждение'),
    el('option', { value: 'block', ...(row?.mode === 'block' ? { selected: 'selected' } : {}) }, 'Жёсткий запрет'));
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, isDefault ? 'SKU (глобальный)' : 'SKU'), skuI),
    el('div', { class: 'form-row' }, el('label', {}, 'Порог'), thrI),
    el('div', { class: 'form-row' }, el('label', {}, 'Режим'), modeS));
  await openModal(row ? 'Изменить порог' : 'Порог по SKU', body, {
    primaryLabel: 'Сохранить',
    onSubmit: async () => {
      const sku = (skuI.value || '').trim();
      if (!sku) { toast('Укажите SKU (или default)', 'error'); return false; }
      try {
        await api.sdSaveThreshold(sku, { threshold: Number(thrI.value) || 0, mode: modeS.value });
        toast('Порог сохранён', 'success');
        onSaved?.();
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

function renderSdAdminPanel() {
  const card = el('div', { class: 'card', style: { marginBottom: '16px' } });
  card.append(el('h3', {}, '⚙ Управление тест-зоной (админ)'));
  const body = el('div', {}, 'Загрузка…');
  card.append(body);

  (async () => {
    let cfg;
    try {
      cfg = await api.supplyDeliverySettings();
    } catch (e) {
      body.textContent = 'Ошибка: ' + (e.message || '');
      return;
    }
    body.textContent = '';

    const enabledCb = el('input', { type: 'checkbox' });
    enabledCb.checked = !!cfg.enabled;
    body.append(el('label', { style: { display: 'block', marginBottom: '10px' } },
      enabledCb, el('span', { style: { marginLeft: '8px' } },
        'Включить тестовую зону (иначе доступ закрыт всем, кроме этой панели)')));

    body.append(el('div', { style: { fontWeight: '600', margin: '8px 0 4px' } },
      'Кому дать тестовый доступ:'));
    const selected = new Set((cfg.test_user_ids || []).map(Number));
    const listBox = el('div', { style: { maxHeight: '220px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' } });
    const cbById = new Map();
    for (const u of (cfg.users || [])) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = selected.has(Number(u.id));
      cbById.set(Number(u.id), cb);
      listBox.append(el('label', { style: { display: 'block', padding: '2px 0' } },
        cb, el('span', { style: { marginLeft: '8px' } },
          `${u.name || u.email} — ${tr('role', u.role) || u.role}`)));
    }
    if (!(cfg.users || []).length) listBox.append(el('div', { style: { color: 'var(--text-muted)' } }, 'Нет пользователей'));
    body.append(listBox);

    const status = el('span', { style: { marginLeft: '10px' } });
    const saveBtn = el('button', { class: 'btn btn-primary', style: { marginTop: '10px' } }, 'Сохранить');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      status.textContent = 'Сохраняю…';
      const test_user_ids = [];
      for (const [id, cb] of cbById) if (cb.checked) test_user_ids.push(id);
      try {
        await api.saveSupplyDeliverySettings({ enabled: enabledCb.checked, test_user_ids });
        status.textContent = 'Сохранено';
        toast('Настройки тест-зоны сохранены', 'success');
      } catch (e) {
        status.textContent = '';
        toast(e.message || 'Ошибка', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
    body.append(el('div', { style: { marginTop: '10px' } }, saveBtn, status));
  })();

  return card;
}

// ============================================================
// Phase 2b — Поставки / Доставки + финмодель (тест-зона, под гейтом)
// ============================================================
const SD_CHANNELS = { wb: 'WB', ozon: 'Ozon', ym: 'Я.Маркет', avito: 'Авито' };
const SD_MODELS = { fbs: 'ФБС', fbo: 'ФБО' };
const SD_SUPPLY_STATUS = { draft: 'черновик', in_work: 'в работе', shipped: 'отгружена' };

function renderSdFinanceCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('h4', {}, 'Финмодель'));
  const body = el('div', {}, 'Загрузка…');
  card.append(body);
  (async () => {
    let s;
    try { s = await api.sdFinanceSettings(); } catch (e) { body.textContent = e.message; return; }
    body.textContent = '';
    body.append(el('div', { style: { marginBottom: '8px' } },
      'Прибыль склада = начисление офиса (вознаграждение) − (упаковка + зарплата + логистика). Упаковка и зарплата считаются по позициям из продуктового справочника.'));
    const rateI = el('input', { type: 'number', min: '0', step: 'any', value: s.labor_rate_per_min || 0, style: { width: '120px' } });
    const status = el('span', { style: { marginLeft: '10px' } });
    const saveBtn = el('button', { class: 'btn btn-primary', onClick: async () => {
      status.textContent = 'Сохраняю…';
      try { await api.sdSaveFinanceSettings({ labor_rate_per_min: Number(rateI.value) || 0 }); status.textContent = 'Сохранено'; toast('Сохранено', 'success'); }
      catch (e) { status.textContent = ''; toast(e.message, 'error'); }
    } }, 'Сохранить');
    body.append(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', {}, 'Ставка труда склада, ₽/мин (стоимость упаковки в минуту)'), rateI, saveBtn, status));
    body.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' } },
      `Вознаграждение (доход) — в «Справочники → Вознаграждение», сейчас: ${s.reward.amount} ${SD_REWARD_UNITS[s.reward.unit] || s.reward.unit}.`));
  })();
  return card;
}

function renderSdSuppliesCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('h4', {}, 'Поставки'),
    el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdCreateSupply(reload) }, '+ Поставка')));
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Канал/Модель'), el('th', {}, 'Юрлицо'),
      el('th', {}, 'Статус'), el('th', {}, 'Позиций (шт)'), el('th', {}, 'Сумма, ₽'), el('th', {}, ''))), tbody));
  async function reload() {
    tbody.textContent = '';
    let rows = [];
    try { rows = await api.sdSupplies(); } catch (e) { toast(e.message, 'error'); }
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '7' }, 'Нет поставок'))); return; }
    for (const s of rows) {
      const open = el('button', { class: 'btn btn-sm', onClick: () => sdOpenSupply(s.id, reload) }, 'Открыть');
      const del = el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
        if (!(await confirm('Удалить поставку?'))) return;
        try { await api.sdDeleteSupply(s.id); reload(); } catch (e) { toast(e.message, 'error'); }
      } }, '🗑');
      const amt = Number(s.total_amount) || 0;
      tbody.append(el('tr', {}, el('td', {}, '#' + s.id),
        el('td', {}, `${SD_CHANNELS[s.channel] || s.channel} / ${SD_MODELS[s.model] || s.model}`),
        el('td', {}, s.legal_entity || '—'), el('td', {}, SD_SUPPLY_STATUS[s.status] || s.status),
        el('td', {}, `${s.item_count} (${s.total_qty})`),
        el('td', { style: { whiteSpace: 'nowrap', fontWeight: '600', color: amt > 0 ? '#0f172a' : 'var(--text-muted)' } },
          amt > 0 ? amt.toLocaleString('ru-RU') : '—'),
        el('td', {}, open, del)));
    }
  }
  reload();
  return card;
}

async function sdCreateSupply(onSaved) {
  const chanS = el('select', {}, ...Object.entries(SD_CHANNELS).map(([v, l]) => el('option', { value: v }, l)));
  const modelS = el('select', {}, el('option', { value: 'fbs' }, 'ФБС'), el('option', { value: 'fbo' }, 'ФБО'));
  const legalI = el('input', { type: 'text' });
  const titleI = el('input', { type: 'text' });
  // WB-канал (с ключом) — нужен для процесса поставки WB. Показываем только для WB.
  const accS = el('select', {}, el('option', { value: '' }, '— WB-канал (для API) —'));
  const accRow = el('div', { class: 'form-row' }, el('label', {}, 'WB-канал'), accS);
  let wbAccList = [];
  api.sdWbAccounts().then((accs) => {
    wbAccList = accs || [];
    for (const a of wbAccList) accS.append(el('option', { value: String(a.id) }, `#${a.id} ${a.legal_entity || ''}`));
  }).catch(() => {});
  // При выборе WB-канала — авто-подставить юрлицо из канала (пользователь просил:
  // раньше указывал канал, но поле «Юрлицо» оставалось пустым → в списке был прочерк).
  accS.addEventListener('change', () => {
    const a = wbAccList.find((x) => String(x.id) === accS.value);
    if (a && a.legal_entity && !legalI.value.trim()) legalI.value = a.legal_entity;
  });
  const syncAccVisible = () => { accRow.style.display = chanS.value === 'wb' ? '' : 'none'; };
  chanS.addEventListener('change', syncAccVisible);
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Канал'), chanS),
    el('div', { class: 'form-row' }, el('label', {}, 'Модель'), modelS),
    accRow,
    el('div', { class: 'form-row' }, el('label', {}, 'Юрлицо'), legalI),
    el('div', { class: 'form-row' }, el('label', {}, 'Название (необязательно)'), titleI));
  syncAccVisible();
  await openModal('Новая поставка', body, { primaryLabel: 'Создать', onSubmit: async () => {
    try {
      await api.sdCreateSupply({
        channel: chanS.value, model: modelS.value,
        legal_entity: legalI.value.trim() || null,
        channel_account_id: (chanS.value === 'wb' && accS.value) ? Number(accS.value) : null,
        title: titleI.value.trim() || null,
      });
      toast('Поставка создана', 'success'); onSaved?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdOpenSupply(id, onChange) {
  const body = el('div', {}, 'Загрузка…');
  async function refresh() {
    let s;
    try { s = await api.sdSupply(id); } catch (e) { body.textContent = e.message; return; }
    body.textContent = '';
    const statusSel = el('select', {}, ...['draft', 'in_work', 'shipped'].map((v) =>
      el('option', { value: v, ...(v === s.status ? { selected: 'selected' } : {}) }, SD_SUPPLY_STATUS[v])));
    statusSel.addEventListener('change', async () => {
      try { await api.sdUpdateSupply(id, { status: statusSel.value }); toast('Статус обновлён', 'success'); onChange?.(); }
      catch (e) { toast(e.message, 'error'); }
    });
    const head = el('div', { style: { marginBottom: '8px' } });
    head.append(el('div', {}, `Канал: ${SD_CHANNELS[s.channel] || s.channel} · Модель: ${SD_MODELS[s.model] || s.model}`));
    if (s.legal_entity) head.append(el('div', {}, `Юрлицо: ${s.legal_entity}`));
    head.append(el('div', { style: { marginTop: '6px' } }, el('span', {}, 'Статус: '), statusSel));
    body.append(head);
    if (s.channel === 'wb' && s.model === 'fbs') body.append(sdWbFbsSection(s, refresh, onChange));
    if (s.channel === 'wb' && s.model === 'fbo') body.append(sdWbFboSection(s, refresh, onChange));
    body.append(el('div', { style: { margin: '8px 0' } },
      el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdAddItem(id, refresh, onChange) }, '+ Позиция')));
    const tbody = el('tbody', {});
    body.append(el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Артикул'), el('th', {}, 'Название'), el('th', {}, 'Кол-во'), el('th', {}, ''))), tbody));
    if (!s.items.length) tbody.append(el('tr', {}, el('td', { colspan: '4' }, 'Пока нет позиций')));
    for (const it of s.items) {
      const del = el('button', { class: 'btn btn-sm btn-danger', onClick: async () => {
        try { await api.sdDeleteSupplyItem(id, it.id); refresh(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
      } }, '🗑');
      tbody.append(el('tr', {}, el('td', {}, it.sku || '—'), el('td', {}, it.name || '—'), el('td', {}, String(it.quantity)), el('td', {}, del)));
    }
  }
  await refresh();
  await openModal(`Поставка #${id}`, body);
}

async function sdAddItem(supplyId, onSaved, onChange) {
  const skuI = el('input', { type: 'text' });
  const nameI = el('input', { type: 'text' });
  const qtyI = el('input', { type: 'number', min: '1', step: '1', value: '1' });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Артикул'), skuI),
    el('div', { class: 'form-row' }, el('label', {}, 'Название'), nameI),
    el('div', { class: 'form-row' }, el('label', {}, 'Кол-во'), qtyI));
  await openModal('Добавить позицию', body, { primaryLabel: 'Добавить', onSubmit: async () => {
    const qty = Number(qtyI.value) || 0;
    if (qty <= 0) { toast('Кол-во должно быть > 0', 'error'); return false; }
    try {
      await api.sdAddSupplyItem(supplyId, { sku: skuI.value.trim() || null, name: nameI.value.trim() || null, quantity: qty });
      toast('Позиция добавлена', 'success'); onSaved?.(); onChange?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

function renderSdDeliveriesCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('h4', {}, 'Доставки'),
    el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdCreateDelivery(reload) }, '+ Доставка')));
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Название'), el('th', {}, 'Поставок'),
      el('th', {}, 'Статус'), el('th', {}, ''))), tbody));
  async function reload() {
    tbody.textContent = '';
    let rows = [];
    try { rows = await api.sdDeliveries(); } catch (e) { toast(e.message, 'error'); }
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '5' }, 'Нет доставок'))); return; }
    for (const d of rows) {
      const open = el('button', { class: 'btn btn-sm', onClick: () => sdOpenDelivery(d.id, reload) }, 'Открыть');
      const del = el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
        if (!(await confirm('Удалить доставку?'))) return;
        try { await api.sdDeleteDelivery(d.id); reload(); } catch (e) { toast(e.message, 'error'); }
      } }, '🗑');
      tbody.append(el('tr', {}, el('td', {}, '#' + d.id), el('td', {}, d.title || '—'),
        el('td', {}, String(d.supply_count)), el('td', {}, d.status === 'closed' ? 'закрыта' : 'черновик'),
        el('td', {}, open, del)));
    }
  }
  reload();
  return card;
}

async function sdCreateDelivery(onSaved) {
  const titleI = el('input', { type: 'text' });
  const logI = el('input', { type: 'number', min: '0', step: 'any', value: '0' });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Название'), titleI),
    el('div', { class: 'form-row' }, el('label', {}, 'Логистика, ₽'), logI));
  await openModal('Новая доставка', body, { primaryLabel: 'Создать', onSubmit: async () => {
    try {
      await api.sdCreateDelivery({ title: titleI.value.trim() || null, logistics_cost: Number(logI.value) || 0 });
      toast('Доставка создана', 'success'); onSaved?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdOpenDelivery(id, onChange) {
  const body = el('div', {}, 'Загрузка…');
  async function refresh() {
    let d;
    try { d = await api.sdDelivery(id); } catch (e) { body.textContent = e.message; return; }
    body.textContent = '';
    const titleI = el('input', { type: 'text', value: d.title || '' });
    const logI = el('input', { type: 'number', min: '0', step: 'any', value: d.logistics_cost || 0 });
    const statusSel = el('select', {},
      el('option', { value: 'draft', ...(d.status !== 'closed' ? { selected: 'selected' } : {}) }, 'Черновик'),
      el('option', { value: 'closed', ...(d.status === 'closed' ? { selected: 'selected' } : {}) }, 'Закрыта'));
    const saveHdr = el('button', { class: 'btn btn-sm', onClick: async () => {
      try { await api.sdUpdateDelivery(id, { title: titleI.value.trim() || null, logistics_cost: Number(logI.value) || 0, status: statusSel.value }); toast('Сохранено', 'success'); refresh(); onChange?.(); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Сохранить');
    const hdr = el('div', { style: { marginBottom: '10px' } });
    hdr.append(el('div', { class: 'form-row' }, el('label', {}, 'Название'), titleI));
    hdr.append(el('div', { class: 'form-row' }, el('label', {}, 'Логистика, ₽'), logI));
    hdr.append(el('div', { class: 'form-row' }, el('label', {}, 'Статус'), statusSel));
    hdr.append(saveHdr);
    body.append(hdr);

    const f = d.finance || {};
    const fin = el('div', { class: 'card', style: { margin: '10px 0' } });
    fin.append(el('h4', {}, 'Финмодель (предварительно)'));
    const line = (label, val) => el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, el('span', {}, label), el('strong', {}, val));
    fin.append(line('Упаковка, ₽', String(f.packaging_cost ?? 0)));
    fin.append(line('Время упаковки, мин', String(f.labor_minutes ?? 0)));
    fin.append(line('Зарплата (время × ₽/мин), ₽', String(f.labor_cost ?? 0)));
    fin.append(line('Логистика, ₽', String(f.logistics_cost ?? 0)));
    if (f.positions_unmapped) {
      fin.append(el('div', { style: { fontSize: '12px', color: '#dc2626', margin: '4px 0' } },
        `⚠️ ${f.positions_unmapped} из ${f.positions_total} позиций нет в продуктовом справочнике — их упаковка/время считаются как 0. Заполни справочник товара.`));
    }
    fin.append(line('Вознаграждение (Σ по сетам позиций), ₽', String(f.reward_amount ?? 0)));
    const profit = line('ЧИСТАЯ ПРИБЫЛЬ СКЛАДА, ₽', String(f.net_profit ?? 0));
    profit.style.fontSize = '16px';
    profit.style.marginTop = '6px';
    profit.style.color = (Number(f.net_profit) >= 0 ? '#16a34a' : '#dc2626');
    fin.append(profit);
    body.append(fin);

    const supBox = el('div', { style: { margin: '10px 0' } });
    supBox.append(el('h4', {}, 'Поставки в доставке'));
    const allSupplies = await api.sdSupplies().catch(() => []);
    const attachedIds = new Set((d.supplies || []).map((s) => s.id));
    const free = allSupplies.filter((s) => !attachedIds.has(s.id));
    const supSel = el('select', {}, el('option', { value: '' }, '— выбрать поставку —'),
      ...free.map((s) => el('option', { value: String(s.id) }, `#${s.id} ${SD_CHANNELS[s.channel] || s.channel}/${SD_MODELS[s.model] || s.model} (${s.total_qty} шт)`)));
    const attachBtn = el('button', { class: 'btn btn-sm btn-primary', style: { marginLeft: '6px' }, onClick: async () => {
      if (!supSel.value) return;
      try { await api.sdAttachSupply(id, Number(supSel.value)); refresh(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Привязать');
    supBox.append(el('div', { style: { marginBottom: '6px' } }, supSel, attachBtn));
    if (!(d.supplies || []).length) supBox.append(el('div', { style: { color: 'var(--text-muted)' } }, 'Поставки не привязаны'));
    for (const s of (d.supplies || [])) {
      const det = el('button', { class: 'btn btn-sm', onClick: async () => {
        try { await api.sdDetachSupply(id, s.id); refresh(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Отвязать');
      supBox.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
        el('span', {}, `#${s.id} ${SD_CHANNELS[s.channel] || s.channel}/${SD_MODELS[s.model] || s.model} · ${s.total_qty} шт`), det));
    }
    body.append(supBox);

    body.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0' } },
      'Упаковка и время считаются автоматически по позициям поставок из продуктового справочника (тип упаковки, расход, время на позицию). Заполни справочник товара — суммы обновятся.'));
  }
  await refresh();
  await openModal(`Доставка #${id}`, body, { size: 'lg' });
}

// ---- Каналы + юрлица + API-ключи (админ) ----
function renderSdChannelsCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('h4', {}, 'Каналы, юрлица и API-ключи'),
    el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdEditChannel(null, null, reload) }, '+ Канал')));
  card.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'Ключи вводит только админ. Один канал/юрлицо закрепляется за одним менеджером канала.'));
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Канал'), el('th', {}, 'Юрлицо'), el('th', {}, 'API-ключ'),
      el('th', {}, 'Менеджер'), el('th', {}, ''))), tbody));
  async function reload() {
    tbody.textContent = '';
    let data;
    try { data = await api.sdChannelAccounts(); } catch (e) { toast(e.message, 'error'); return; }
    const users = data.users || [];
    if (!(data.accounts || []).length) { tbody.append(el('tr', {}, el('td', { colspan: '5' }, 'Каналы не заведены'))); return; }
    for (const a of data.accounts) {
      const edit = el('button', { class: 'btn btn-sm', onClick: () => sdEditChannel(a, users, reload) }, '✏');
      const del = el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
        if (!(await confirm('Удалить канал?'))) return;
        try { await api.sdDeleteChannelAccount(a.id); reload(); } catch (e) { toast(e.message, 'error'); }
      } }, '🗑');
      tbody.append(el('tr', {}, el('td', {}, SD_CHANNELS[a.channel] || a.channel), el('td', {}, a.legal_entity || '—'),
        el('td', {}, a.key_set ? (a.key_mask || 'задан') : '—'), el('td', {}, a.manager_name || '—'), el('td', {}, edit, del)));
    }
  }
  reload();
  return card;
}

async function sdEditChannel(acc, users, onSaved) {
  let userList = users;
  if (!userList) { try { const d = await api.sdChannelAccounts(); userList = d.users || []; } catch { userList = []; } }
  const chanS = el('select', {}, ...Object.entries(SD_CHANNELS).map(([v, l]) =>
    el('option', { value: v, ...(acc && acc.channel === v ? { selected: 'selected' } : {}) }, l)));
  const legalI = el('input', { type: 'text', value: acc?.legal_entity || '' });
  const keyI = el('input', { type: 'text', placeholder: acc?.key_set ? 'оставьте пустым — ключ не изменится' : 'API-ключ' });
  const keyHint = el('div', { style: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' } });
  function updateKeyHint() {
    const v = chanS.value;
    if (v === 'wb') keyHint.textContent = 'WB: токен из seller.wildberries.ru (категории Контент + Маркетплейс).';
    else if (v === 'ozon') keyHint.textContent = 'Ozon: JSON {"client_id":"...","api_key":"..."} или строка «client_id:api_key».';
    else if (v === 'ym') keyHint.textContent = 'ЯМ: JSON {"token":"...","business_id":"..."} или «business_id:token». business_id — ЧИСЛО из кабинета ЯМ (Настройки → Настройки API → «Идентификатор бизнес-аккаунта»), НЕ логин и НЕ название магазина.';
    else keyHint.textContent = '';
  }
  chanS.addEventListener('change', updateKeyHint);
  updateKeyHint();
  const mgrS = el('select', {}, el('option', { value: '' }, '— менеджер канала —'),
    ...userList.map((u) => el('option', { value: String(u.id), ...(acc && Number(acc.manager_id) === Number(u.id) ? { selected: 'selected' } : {}) },
      `${u.name || u.email} (${tr('role', u.role) || u.role})`)));
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Канал'), chanS),
    el('div', { class: 'form-row' }, el('label', {}, 'Юрлицо'), legalI),
    el('div', { class: 'form-row' }, el('label', {}, 'API-ключ'), el('div', {}, keyI, keyHint)),
    el('div', { class: 'form-row' }, el('label', {}, 'Менеджер канала'), mgrS));
  await openModal(acc ? 'Изменить канал' : 'Новый канал', body, { primaryLabel: 'Сохранить', onSubmit: async () => {
    const payload = { channel: chanS.value, legal_entity: legalI.value.trim() || null, manager_id: mgrS.value ? Number(mgrS.value) : null };
    if (keyI.value.trim()) payload.api_key = keyI.value.trim();
    try {
      if (acc) await api.sdUpdateChannelAccount(acc.id, payload);
      else await api.sdCreateChannelAccount(payload);
      toast('Канал сохранён', 'success'); onSaved?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// ---- Продуктовый справочник (МойСклад-номенклатура) ----
function renderSdProductDirectoryCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('h4', {}, 'Справочник товара (номенклатура МойСклад)'));
  card.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'На позицию: тип упаковки + расход упаковки + время упаковки (мин) + габариты. Отсюда считаются упаковка и зарплата в доставке. Сопоставление с каналами — при интеграции канала.'));
  const searchI = el('input', { type: 'text', placeholder: 'Поиск по SKU или названию', style: { width: '260px' } });
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: () => reload() }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });
  card.append(el('div', { style: { marginBottom: '8px' } }, searchI, findBtn));
  const tbody = el('tbody', {});
  card.append(el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'SKU'), el('th', {}, 'Название'), el('th', {}, 'Упаковка'),
      el('th', {}, 'Расход'), el('th', {}, 'Время, мин'), el('th', {}, 'Габариты'), el('th', {}, ''))), tbody));
  let tariffs = [];
  async function reload() {
    tbody.textContent = '';
    try { tariffs = await api.sdTariffs(); } catch { tariffs = []; }
    let rows = [];
    try { rows = await api.sdProductDirectory(searchI.value.trim()); } catch (e) { toast(e.message, 'error'); return; }
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '7' }, 'Ничего не найдено'))); return; }
    for (const r of rows) {
      const dims = [r.dim_l, r.dim_w, r.dim_h].every((x) => x == null) ? '—' : `${r.dim_l ?? '?'}×${r.dim_w ?? '?'}×${r.dim_h ?? '?'}`;
      const pkg = r.packaging_tariff_id ? `${r.packaging_name || '?'} (${r.packaging_unit || ''})` : '—';
      const edit = el('button', { class: 'btn btn-sm', onClick: () => sdEditProduct(r, tariffs, reload) }, '✏');
      tbody.append(el('tr', {}, el('td', {}, r.sku || '—'), el('td', {}, r.name || '—'), el('td', {}, pkg),
        el('td', {}, String(r.packaging_consumption ?? 0)), el('td', {}, String(r.packing_time_min ?? 0)),
        el('td', {}, dims), el('td', {}, edit)));
    }
  }
  reload();
  return card;
}

async function sdEditProduct(row, tariffs, onSaved) {
  const tarSel = el('select', {}, el('option', { value: '' }, '— без упаковки —'),
    ...tariffs.map((t) => el('option', { value: String(t.id), ...(Number(row.packaging_tariff_id) === Number(t.id) ? { selected: 'selected' } : {}) }, `${t.name} (${t.cost}₽/${t.unit || 'шт'})`)));
  const consI = el('input', { type: 'number', min: '0', step: 'any', value: row.packaging_consumption ?? 0 });
  const timeI = el('input', { type: 'number', min: '0', step: 'any', value: row.packing_time_min ?? 0 });
  const lI = el('input', { type: 'number', min: '0', step: 'any', value: row.dim_l ?? '', style: { width: '70px' } });
  const wI = el('input', { type: 'number', min: '0', step: 'any', value: row.dim_w ?? '', style: { width: '70px' } });
  const hI = el('input', { type: 'number', min: '0', step: 'any', value: row.dim_h ?? '', style: { width: '70px' } });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Тип упаковки'), tarSel),
    el('div', { class: 'form-row' }, el('label', {}, 'Расход упаковки (в ед. упаковки)'), consI),
    el('div', { class: 'form-row' }, el('label', {}, 'Время упаковки, мин'), timeI),
    el('div', { class: 'form-row' }, el('label', {}, 'Габариты Д×Ш×В'), el('div', { style: { display: 'flex', gap: '6px' } }, lI, wI, hI)));
  await openModal(`Товар: ${row.name || row.sku}`, body, { primaryLabel: 'Сохранить', onSubmit: async () => {
    const payload = {
      packaging_tariff_id: tarSel.value ? Number(tarSel.value) : null,
      packaging_consumption: Number(consI.value) || 0,
      packing_time_min: Number(timeI.value) || 0,
      dim_l: lI.value !== '' ? Number(lI.value) : null,
      dim_w: wI.value !== '' ? Number(wI.value) : null,
      dim_h: hI.value !== '' ? Number(hI.value) : null,
    };
    try { await api.sdSaveProductDirectory(row.product_id, payload); toast('Сохранено', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// ---- Сверка габаритов: кабинет МП ⇄ наш сет ----
function renderSdSizeMapCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('h4', {}, 'Сверка габаритов (кабинет МП ⇄ наш сет)'));
  card.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'Габариты из кабинета маркетплейса против габаритов сета (CRM — эталон). Если МП отклоняется от CRM больше порога — строка красная. Габариты МП подтягиваются вместе с номенклатурой (WB — есть; Ozon/ЯМ — после подтяжки).'));
  const chanSel = el('select', {}, ...Object.entries(SD_CHANNELS).map(([v, l]) => el('option', { value: v }, l)));
  const thrI = el('input', { type: 'number', min: '0', step: 'any', value: '10', style: { width: '80px' } });
  const info = el('span', { style: { marginLeft: '8px', color: 'var(--text-muted)' } });
  const findBtn = el('button', { class: 'btn btn-sm', onClick: () => reload() }, 'Показать');
  chanSel.addEventListener('change', () => reload());
  thrI.addEventListener('change', () => reload());
  card.append(el('div', { style: { marginBottom: '8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
    chanSel, el('span', {}, '% отклонения:'), thrI, findBtn, info));
  const tbody = el('tbody', {});
  card.append(el('div', { style: { overflowX: 'auto' } }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Артикул канала'), el('th', {}, 'Название'), el('th', {}, 'Юрлицо'),
      el('th', {}, 'Сет'), el('th', {}, 'Габариты МП (Д×Ш×В)'), el('th', {}, 'Габариты сета'), el('th', {}, 'Макс. откл.'))), tbody)));
  const fmtDims = (l, w, h) => [l, w, h].every((x) => x == null) ? '—' : `${l ?? '?'}×${w ?? '?'}×${h ?? '?'}`;
  async function reload() {
    tbody.textContent = '';
    let data;
    try { data = await api.sdSizeMap(chanSel.value, Number(thrI.value) || 10); } catch (e) { toast(e.message, 'error'); return; }
    info.textContent = `Нарушений: ${data.over_count} из ${data.rows.length}`;
    if (!data.rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '7' }, 'Нет данных: подтяни номенклатуру с габаритами и сопоставь с сетами.'))); return; }
    for (const r of data.rows) {
      const devTxt = r.max_dev == null ? '—' : `${r.max_dev.toFixed(1)}%`;
      tbody.append(el('tr', r.over ? { style: { background: 'rgba(220,38,38,0.12)' } } : {},
        el('td', {}, r.channel_sku || r.channel_barcode || '—'),
        el('td', {}, r.channel_name || '—'),
        el('td', {}, r.legal_entity || '—'),
        el('td', {}, r.set_name || ('#' + r.set_id)),
        el('td', {}, fmtDims(r.channel_dim_l, r.channel_dim_w, r.channel_dim_h)),
        el('td', {}, fmtDims(r.set_dim_l, r.set_dim_w, r.set_dim_h)),
        el('td', { style: { fontWeight: '600', color: r.over ? '#dc2626' : 'inherit' } }, devTxt)));
    }
  }
  reload();
  return card;
}

// ---- Сопоставление номенклатуры канала ⇄ внутренней (matching) ----
function renderSdChannelMapCard(isAdmin) {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('h4', {}, 'Сопоставление с каналом (matching)'));
  card.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'Номенклатура канала ⇄ твоя МойСклад-номенклатура. Импортируй список канала (или подтяни из WB API), затем «Авто-сопоставить» по артикулу; остальное — вручную.'));
  const chanSel = el('select', {}, ...Object.entries(SD_CHANNELS).map(([v, l]) => el('option', { value: v }, l)));
  const statusSel = el('select', {}, el('option', { value: 'all' }, 'Все'),
    el('option', { value: 'unmatched' }, 'Не сопоставленные'), el('option', { value: 'matched' }, 'Сопоставленные'));
  // Фильтр по юрлицу (WB-каналу): пусто = все. Заполняется из /wb/accounts.
  const accSel = el('select', {}, el('option', { value: '' }, 'Все юрлица'));
  let wbAccounts = [];
  // Видимость: по умолчанию прячем скрытые (таблица длинная, с телефона тяжело).
  const visSel = el('select', {}, el('option', { value: 'active' }, 'Активные'),
    el('option', { value: 'hidden' }, 'Скрытые'), el('option', { value: 'all' }, 'Все (со скрытыми)'));
  const searchI = el('input', { type: 'text', placeholder: 'Поиск', style: { width: '150px' } });
  const info = el('span', { style: { marginLeft: '8px', color: 'var(--text-muted)' } });
  const findBtn = el('button', { class: 'btn btn-sm', onClick: () => reload() }, 'Показать');
  const importBtn = el('button', { class: 'btn btn-sm', onClick: () => sdImportChannelModal(chanSel.value, reload) }, 'Импорт');
  const autoBtn = el('button', { class: 'btn btn-sm', onClick: async () => {
    try { const r = await api.sdAutoMatchChannel(chanSel.value); toast(`Сопоставлено: ${r.matched}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  } }, 'Авто (по SKU склада)');
  // Авто-сопоставление по артикулу СЕТА: WB — артикул продавца, Ozon — штрихкод, ЯМ — SKU.
  const autoArtBtn = el('button', { class: 'btn btn-sm', title: 'Сопоставить по артикулу сета (WB=артикул продавца, Ozon=штрихкод, ЯМ=SKU)', onClick: async () => {
    try { const r = await api.sdAutoMatchArticle(chanSel.value); toast(`Сопоставлено по артикулу сета: ${r.matched}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  } }, 'Авто по артикулу сета');
  // Массово скрыть уже сопоставленные — чтобы в списке осталось только то, что ещё нужно связать.
  const hideMatchedBtn = el('button', { class: 'btn btn-sm', title: 'Скрыть из списка все сопоставленные строки этого канала', onClick: async () => {
    if (!(await confirm('Скрыть все сопоставленные строки этого канала из рабочего списка? Их можно вернуть фильтром «Скрытые».'))) return;
    try { const r = await api.sdHideMatchedChannel(chanSel.value); toast(`Скрыто: ${r.hidden}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  } }, 'Скрыть сопоставленные');
  const controls = el('div', { style: { marginBottom: '8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
    chanSel, statusSel, accSel, visSel, searchI, findBtn, importBtn, autoBtn, autoArtBtn, hideMatchedBtn);
  // Подтяжка из WB: по ВЫБРАННОМУ юрлицу, а при «Все юрлица» — по всем WB-каналам
  // с ключом (раньше бралось только первое юрлицо — это и был баг). Действие
  // админское (пишет много строк + ходит во внешний API), фильтр — для всех.
  // Подтяжка из МП — универсальная модалка: выбираешь галочками, что и откуда
  // выгрузить (канал × юрлицо). Заменила «Подтянуть из WB API» (только WB).
  let pullBtn = null;
  if (isAdmin) {
    pullBtn = el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdPullFromMpModal(reload) }, '⬇ Подтянуть из МП');
    controls.append(pullBtn);
  }
  // Фильтр по юрлицу актуален только для WB (у Ozon/ЯМ этот фильтр пока не используется в matching).
  function syncChannelUi() {
    const isWb = chanSel.value === 'wb';
    accSel.style.display = isWb ? '' : 'none';
  }
  chanSel.addEventListener('change', () => { accSel.value = ''; syncChannelUi(); reload(); });
  statusSel.addEventListener('change', () => reload());
  accSel.addEventListener('change', () => reload());
  visSel.addEventListener('change', () => reload());
  card.append(controls, info);
  const tbody = el('tbody', {});
  // overflow-x — чтобы широкая таблица горизонтально скроллилась на телефоне, а не ломала вёрстку.
  card.append(el('div', { style: { overflowX: 'auto' } }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'ШК канала'), el('th', {}, 'Артикул канала'), el('th', {}, 'Название'),
      el('th', {}, 'Юрлицо'), el('th', {}, 'Сопоставлен товар'), el('th', {}, ''))), tbody)));
  let mapOffset = 0;
  const moreWrap = el('div', { style: { marginTop: '8px', textAlign: 'center' } });
  card.append(moreWrap);
  async function loadAccounts() {
    try { wbAccounts = await api.sdWbAccounts(); } catch { wbAccounts = []; }
    for (const a of wbAccounts) accSel.append(el('option', { value: String(a.id) }, a.legal_entity || ('WB #' + a.id)));
  }
  function rowEl(m) {
    const matched = m.set_id
      ? el('span', {}, `сет: ${m.set_name || '#' + m.set_id}`)
      : el('em', { style: { color: '#dc2626' } }, 'не сопоставлено');
    const matchBtn = el('button', { class: 'btn btn-sm', onClick: () => sdMatchSetModal(m.id, reload) }, m.set_id ? 'Изм.' : 'Сопоставить с сетом');
    const unBtn = m.set_id ? el('button', { class: 'btn btn-sm', style: { marginLeft: '4px' }, onClick: async () => {
      try { await api.sdUnmatchChannel(m.id); reload(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Снять') : null;
    // Скрыть/показать строку — быстро убрать из рабочего списка.
    const hideBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '4px' }, title: m.hidden ? 'Показать' : 'Скрыть из списка',
      onClick: async () => { try { await api.sdHideChannel(m.id, !m.hidden); reload(); } catch (e) { toast(e.message, 'error'); } } }, m.hidden ? '👁' : '🙈');
    const del = el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
      try { await api.sdDeleteChannelMap(m.id); reload(); } catch (e) { toast(e.message, 'error'); }
    } }, '🗑');
    return el('tr', { style: m.hidden ? { opacity: '0.55' } : {} },
      el('td', {}, m.channel_barcode || '—'), el('td', {}, m.channel_sku || '—'),
      el('td', {}, m.channel_name || '—'), el('td', {}, m.legal_entity || '—'), el('td', {}, matched), el('td', {}, matchBtn, unBtn, hideBtn, del));
  }
  async function fetchPage(append) {
    if (!append) { tbody.textContent = ''; mapOffset = 0; }
    let data;
    const accFilter = chanSel.value === 'wb' ? accSel.value : '';
    try { data = await api.sdChannelMap(chanSel.value, statusSel.value, searchI.value.trim(), accFilter, visSel.value, mapOffset); } catch (e) { toast(e.message, 'error'); return; }
    if (!append) info.textContent = `Сопоставлено ${data.matched} из ${data.total}` + (data.hidden ? ` · скрыто ${data.hidden}` : '');
    for (const m of data.rows) tbody.append(rowEl(m));
    if (!append && !data.rows.length) tbody.append(el('tr', {}, el('td', { colspan: '6' }, 'Пусто')));
    mapOffset += data.rows.length;
    moreWrap.textContent = '';
    if (data.has_more) {
      moreWrap.append(el('button', { class: 'btn btn-sm', onClick: () => fetchPage(true) }, `Показать ещё (загружено ${mapOffset})`));
    } else if (mapOffset > (data.limit || 200)) {
      moreWrap.append(el('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, `Показаны все загруженные: ${mapOffset}`));
    }
  }
  function reload() { return fetchPage(false); }
  loadAccounts();
  syncChannelUi();
  reload();
  return card;
}

// Универсальная подтяжка номенклатуры из МП: чекбоксы по всем заведённым каналам
// (WB / Ozon / ЯМ), выбираешь точечно юрлица — тянем только их. Ошибки по каналам
// отдельно, чтобы одно юрлицо не заблокировало остальные.
async function sdPullFromMpModal(onDone) {
  let accounts = [];
  try { accounts = await api.sdChannelAccountsLite(); } catch (e) { toast(e.message, 'error'); return; }
  const pullable = (accounts || []).filter((a) => ['wb', 'ozon', 'ym'].includes(a.channel));
  if (!pullable.length) { toast('Нет каналов с ключами. Заведи их в «Каналы».', 'error'); return; }
  const groups = { wb: [], ozon: [], ym: [] };
  for (const a of pullable) groups[a.channel].push(a);
  const checkboxes = new Map(); // acc.id → input
  const body = el('div', {});
  body.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' } },
    'Выбери, что и откуда выгрузить. Каждый канал тянется независимо (ошибка одного не мешает остальным). Габариты и штрихкоды из кабинета МП сохраняются вместе с номенклатурой (для сверки размеров).'));
  const status = el('div', { style: { fontSize: '13px', minHeight: '18px', marginTop: '8px' } });
  for (const ch of ['wb', 'ozon', 'ym']) {
    if (!groups[ch].length) continue;
    const chLabel = SD_CHANNELS[ch] || ch.toUpperCase();
    const group = el('div', { style: { marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid var(--border, #e5e7eb)' } });
    const groupHeader = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', marginBottom: '4px' } });
    const allCb = el('input', { type: 'checkbox', checked: 'checked', style: { marginRight: '4px' } });
    allCb.addEventListener('change', () => {
      for (const a of groups[ch]) checkboxes.get(a.id).checked = allCb.checked;
    });
    groupHeader.append(allCb, el('span', {}, `${chLabel} (${groups[ch].length} юрлиц)`));
    group.append(groupHeader);
    for (const a of groups[ch]) {
      const cb = el('input', { type: 'checkbox', checked: 'checked', style: { marginRight: '6px' } });
      checkboxes.set(a.id, cb);
      const label = el('label', { style: { display: 'flex', alignItems: 'center', paddingLeft: '20px', margin: '2px 0' } },
        cb, el('span', {}, a.legal_entity || ('#' + a.id)));
      group.append(label);
    }
    body.append(group);
  }
  body.append(status);
  await openModal('Подтянуть номенклатуру из МП', body, { primaryLabel: 'Подтянуть выбранные', onSubmit: async () => {
    const selected = pullable.filter((a) => checkboxes.get(a.id)?.checked);
    if (!selected.length) { toast('Ничего не выбрано', 'error'); return false; }
    let total = 0; const errs = [];
    for (let i = 0; i < selected.length; i += 1) {
      const a = selected[i];
      status.textContent = `Тяну ${i + 1}/${selected.length}: ${(SD_CHANNELS[a.channel] || a.channel).toUpperCase()} · ${a.legal_entity || '#' + a.id}…`;
      try {
        const fn = a.channel === 'wb' ? api.sdPullWb : (a.channel === 'ozon' ? api.sdPullOzon : api.sdPullYm);
        const r = await fn(a.id);
        total += Number(r.pulled) || 0;
      } catch (e) { errs.push(`${(SD_CHANNELS[a.channel] || a.channel).toUpperCase()} · ${a.legal_entity || '#' + a.id}: ${e.message}`); }
    }
    // Авто-мапинг по артикулу сета для каналов, где были подтяжки — как после «Подтянуть из МС».
    const touchedChannels = [...new Set(selected.map((a) => a.channel))];
    let autoMatched = 0;
    for (const ch of touchedChannels) {
      try { const a = await api.sdAutoMatchArticle(ch); autoMatched += a.matched || 0; } catch { /* канал мог быть пуст */ }
    }
    let msg = `Подтянуто позиций: ${total}`;
    if (autoMatched) msg += `. Сопоставлено с сетами по артикулу: ${autoMatched}`;
    if (errs.length) toast(`${msg}. Ошибки: ${errs.join(' | ')}`, 'error');
    else toast(msg, 'success');
    onDone?.();
  } });
}

async function sdImportChannelModal(channel, onSaved) {
  const ta = el('textarea', { style: { width: '100%', height: '160px' }, placeholder: 'штрихкод;артикул;название' });
  const body = el('div', {},
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
      `Импорт номенклатуры канала «${SD_CHANNELS[channel] || channel}». Одна строка = товар, формат: штрихкод ; артикул ; название (разделитель ; или таб).`),
    ta);
  await openModal('Импорт номенклатуры канала', body, { primaryLabel: 'Импортировать', onSubmit: async () => {
    const items = [];
    for (const raw of ta.value.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[;\t]/).map((x) => x.trim());
      const [barcode, sku, name] = parts;
      if (!barcode && !sku) continue;
      items.push({ barcode: barcode || null, sku: sku || null, name: name || null });
    }
    if (!items.length) { toast('Нет строк', 'error'); return false; }
    try { const r = await api.sdImportChannelMap({ channel, items }); toast(`Импортировано: ${r.imported}`, 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdMatchProductModal(mapId, onSaved) {
  let selected = null;
  const searchI = el('input', { type: 'text', placeholder: 'Поиск товара (SKU/название)', style: { width: '240px' } });
  const chosen = el('div', { style: { margin: '6px 0', fontWeight: '600' } }, 'Товар не выбран');
  const resBox = el('div', { style: { maxHeight: '240px', overflow: 'auto' } });
  async function doSearch() {
    resBox.textContent = 'Поиск…';
    let rows = [];
    try { rows = await api.sdProductDirectory(searchI.value.trim()); } catch (e) { resBox.textContent = e.message; return; }
    resBox.textContent = '';
    if (!rows.length) { resBox.textContent = 'Ничего не найдено'; return; }
    for (const r of rows.slice(0, 50)) {
      const b = el('button', { class: 'btn btn-sm', style: { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' },
        onClick: () => { selected = r.product_id; chosen.textContent = `Выбрано: ${r.sku || ''} ${r.name || ''}`; } },
        `${r.sku || ''} — ${r.name || ''}`);
      resBox.append(b);
    }
  }
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: doSearch }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  const body = el('div', {}, el('div', { style: { display: 'flex' } }, searchI, findBtn), chosen, resBox);
  await openModal('Сопоставить с товаром', body, { primaryLabel: 'Сопоставить', onSubmit: async () => {
    if (!selected) { toast('Выберите товар', 'error'); return false; }
    try { await api.sdMatchChannel(mapId, selected); toast('Сопоставлено', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// ---- WB ФБС: процесс поставки (UI) ----
function sdWbFbsSection(s, refresh, onChange) {
  const box = el('div', { class: 'card', style: { margin: '8px 0' } });
  box.append(el('h4', {}, 'WB ФБС — процесс поставки'));
  if (!s.channel_account_id) {
    box.append(el('div', { style: { color: '#dc2626' } },
      'Не выбран WB-канал с ключом. Пересоздай поставку с указанием WB-канала (ключ заводится в «Каналы»).'));
    return box;
  }
  const id = s.id;
  if (!s.external_supply_id) {
    box.append(el('div', { style: { marginBottom: '6px' } }, 'Поставка ещё не создана в WB.'));
    const btns0 = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
    btns0.append(el('button', { class: 'btn btn-sm', onClick: async () => {
      try { const r = await api.sdWbCreateSupply(id); toast('Создана в WB: ' + r.external_supply_id, 'success'); refresh(); onChange?.(); }
      catch (e) { toast(e.message, 'error'); }
    } }, 'Создать пустую поставку'));
    // Одним кликом: создать поставку в WB + запихнуть в неё ВСЕ свободные сборочные задания.
    btns0.append(el('button', { class: 'btn btn-sm btn-primary', title: 'Создаст поставку в WB и добавит в неё все не взятые в отгрузку задания',
      onClick: async () => {
        if (!(await confirm('Создать поставку в WB и добавить в неё ВСЕ свободные сборочные задания? (обычно то, что нужно)'))) return;
        try {
          const r = await api.sdWbAttachAll(id);
          const errs = (r.errors || []).length;
          toast(errs ? `Создано, добавлено ${r.attached} из ${r.total}. Ошибок: ${errs}` : `Готово! Добавлено ${r.attached} заданий в поставку ${r.external_supply_id}`, errs ? 'error' : 'success');
          refresh(); onChange?.();
        } catch (e) { toast(e.message, 'error'); }
      } }, '⚡ Создать и добавить ВСЕ новые'));
    box.append(btns0);
    return box;
  }
  box.append(el('div', { style: { marginBottom: '6px' } }, `WB supplyId: ${s.external_supply_id} · статус: ${s.external_status || '—'}`));
  const btns = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  btns.append(el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdWbNewOrdersModal(id, refresh, onChange) }, 'Сборочные задания'));
  // Добавить ВСЕ свободные к УЖЕ созданной поставке.
  btns.append(el('button', { class: 'btn btn-sm', title: 'Добавить все не взятые в отгрузку задания в эту поставку', onClick: async () => {
    if (!(await confirm('Добавить в эту поставку ВСЕ свободные сборочные задания?'))) return;
    try {
      const r = await api.sdWbAttachAll(id);
      const errs = (r.errors || []).length;
      toast(errs ? `Добавлено ${r.attached} из ${r.total}. Ошибок: ${errs}` : `Добавлено ${r.attached} заданий`, errs ? 'error' : 'success');
      refresh(); onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  } }, '+ Все свободные'));
  btns.append(el('button', { class: 'btn btn-sm', onClick: async () => {
    try { const b = await api.sdWbBarcode(id); sdShowWbBarcode(b); } catch (e) { toast(e.message, 'error'); }
  } }, 'Штрихкод поставки'));
  btns.append(el('button', { class: 'btn btn-sm', onClick: async () => {
    if (!(await confirm('Передать поставку в доставку (после физической отгрузки)? Отменить нельзя.'))) return;
    try { await api.sdWbDeliver(id); toast('Передано в доставку', 'success'); refresh(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
  } }, 'Передать в доставку'));
  box.append(btns);
  return box;
}

async function sdWbNewOrdersModal(supplyId, refresh, onChange) {
  const list = el('div', {});
  const count = el('span', { style: { marginLeft: '8px', color: 'var(--text-muted)' } });
  async function load() {
    list.textContent = 'Загрузка…';
    count.textContent = '';
    let orders = [];
    try { orders = await api.sdWbNewOrders(supplyId); } catch (e) { list.textContent = e.message; return; }
    list.textContent = '';
    count.textContent = orders.length ? `Свободных: ${orders.length}` : '';
    if (!orders.length) { list.textContent = 'Нет новых сборочных заданий'; return; }
    for (const o of orders) {
      const add = el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
        try { await api.sdWbAttachOrder(supplyId, { order_id: o.order_id, article: o.article, barcode: o.barcode, name: o.name }); toast('Добавлено в поставку', 'success'); add.disabled = true; refresh(); onChange?.(); }
        catch (e) { toast(e.message, 'error'); }
      } }, 'Добавить');
      list.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' } },
        el('span', {}, `#${o.order_id} · ${o.article || '—'} · ${o.barcode || ''}`), add));
    }
  }
  const reloadBtn = el('button', { class: 'btn btn-sm', onClick: load }, 'Обновить');
  const attachAllBtn = el('button', { class: 'btn btn-sm btn-primary', style: { marginLeft: '6px' },
    onClick: async () => {
      if (!(await confirm('Добавить ВСЕ свободные сборочные задания в эту поставку?'))) return;
      try {
        const r = await api.sdWbAttachAll(supplyId);
        const errs = (r.errors || []).length;
        toast(errs ? `Добавлено ${r.attached} из ${r.total}. Ошибок: ${errs}` : `Добавлено ${r.attached} заданий`, errs ? 'error' : 'success');
        load(); refresh(); onChange?.();
      } catch (e) { toast(e.message, 'error'); }
    } }, '+ Добавить ВСЕ');
  const body = el('div', {},
    el('div', { style: { marginBottom: '8px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' } }, reloadBtn, attachAllBtn, count),
    list);
  load();
  await openModal('Сборочные задания WB', body);
}

// ---- WB ФБО: выбор склада приёмки + слоты + коэффициенты (платность) ----
// WB не даёт создавать ФБО-заявку через API — только читаем склады/коэффициенты,
// менеджер планирует в CRM (склад+дата+тип короба), потом добавляет позиции
// (SKU+qty) и оформляет заявку в личном кабинете WB (кнопка «Открыть в WB LK»).
function sdWbFboSection(s, refresh, onChange) {
  const box = el('div', { class: 'card', style: { margin: '8px 0' } });
  box.append(el('h4', {}, 'WB ФБО — приёмка на склад маркетплейса'));
  if (!s.channel_account_id) {
    box.append(el('div', { style: { color: '#dc2626' } },
      'Не выбран WB-канал с ключом. Пересоздай поставку с указанием WB-канала (ключ в «Каналы»).'));
    return box;
  }
  const meta = s.external_meta || {};
  const currentPlan = el('div', { style: { fontSize: '13px', marginBottom: '6px' } });
  function renderPlan() {
    currentPlan.textContent = '';
    if (meta.fbo_warehouse_name || meta.fbo_plan_date) {
      currentPlan.append(el('span', { style: { fontWeight: '600' } },
        `📋 План: склад «${meta.fbo_warehouse_name || meta.fbo_warehouse_id || '—'}»`),
        meta.fbo_plan_date ? el('span', {}, ` · дата ${meta.fbo_plan_date}`) : null,
        meta.fbo_coefficient != null ? el('span', {},
          meta.fbo_coefficient === 0 ? ' · бесплатно ✅' :
          meta.fbo_coefficient > 0 ? ` · платно ×${meta.fbo_coefficient} 💸` : ' · недоступно') : null,
        meta.fbo_box_type ? el('span', {}, ` · тип «${meta.fbo_box_type}»`) : null);
    } else {
      currentPlan.append(el('em', { style: { color: 'var(--text-muted)' } }, 'План приёмки не задан — открой «Подобрать склад и дату».'));
    }
  }
  renderPlan();
  box.append(currentPlan);
  const btns = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  btns.append(el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdWbFboPlanModal(s, () => { refresh(); onChange?.(); }) }, '📅 Подобрать склад и дату'));
  // Прямая ссылка в кабинет WB для реального создания заявки на приёмку (API-создание не поддерживается).
  btns.append(el('a', { class: 'btn btn-sm', href: 'https://seller.wildberries.ru/supplies-management/all-supplies', target: '_blank', rel: 'noopener' }, '🌐 Открыть в кабинете WB'));
  box.append(btns);
  return box;
}

async function sdWbFboPlanModal(supply, onSaved) {
  let warehouses = [];
  let rows = []; // коэффициенты по датам
  const status = el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } }, 'Загружаю склады WB…');
  const whSel = el('select', { multiple: 'multiple', size: '6', style: { minWidth: '260px' } });
  const tbody = el('tbody', {});
  const table = el('div', { style: { overflowX: 'auto', maxHeight: '380px', overflowY: 'auto' } },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Дата'), el('th', {}, 'Склад'),
        el('th', {}, 'Короб'), el('th', {}, 'Коэф.'), el('th', {}, 'Стоимость'), el('th', {}, ''))),
      tbody));
  async function loadWarehouses() {
    try { warehouses = await api.sdWbFboWarehouses(supply.channel_account_id); }
    catch (e) { status.textContent = 'Ошибка складов: ' + e.message; return; }
    whSel.textContent = '';
    for (const w of warehouses) {
      const opt = el('option', { value: String(w.id) }, `${w.name || '#' + w.id}${w.address ? ' — ' + w.address.slice(0, 60) : ''}`);
      whSel.append(opt);
    }
    status.textContent = warehouses.length ? `Складов WB: ${warehouses.length}. Выбери один или несколько → «Показать слоты».` : 'Складов WB не пришло. Проверь токен (нужны права «Поставки»).';
  }
  async function loadCoefs() {
    const selected = Array.from(whSel.selectedOptions).map((o) => o.value);
    if (!selected.length) { status.textContent = 'Выбери хотя бы один склад'; return; }
    status.textContent = `Загружаю коэффициенты для ${selected.length} складов…`;
    try { rows = await api.sdWbFboCoefficients(supply.channel_account_id, selected); }
    catch (e) { status.textContent = 'Ошибка коэффициентов: ' + e.message; return; }
    tbody.textContent = '';
    // Сортируем: сначала бесплатные (coef=0), потом дешёвые, недоступные (−1) в конце.
    const sorted = [...rows].sort((a, b) => {
      const ka = a.coefficient == null ? 999 : (a.coefficient < 0 ? 998 : a.coefficient);
      const kb = b.coefficient == null ? 999 : (b.coefficient < 0 ? 998 : b.coefficient);
      if (ka !== kb) return ka - kb;
      return (a.date || '').localeCompare(b.date || '');
    });
    const available = sorted.filter((r) => r.coefficient != null && r.coefficient >= 0);
    status.textContent = `Всего слотов: ${sorted.length}, доступно: ${available.length}, бесплатных: ${sorted.filter((r) => r.coefficient === 0).length}. Клик по «Выбрать» — сохранит в план.`;
    for (const r of sorted) {
      const coefText = r.coefficient == null ? '—' : (r.coefficient < 0 ? 'нельзя' : r.coefficient === 0 ? 'бесплатно' : `×${r.coefficient}`);
      const costClass = r.coefficient === 0 ? '#16a34a' : r.coefficient > 0 ? '#b45309' : '#dc2626';
      const dateShort = r.date ? r.date.slice(0, 10) : '—';
      const pick = r.coefficient != null && r.coefficient >= 0
        ? el('button', { class: 'btn btn-sm btn-primary', onClick: async () => {
            try {
              await api.sdSupplyFboPlan(supply.id, {
                warehouse_id: r.warehouseID, warehouse_name: r.warehouseName || null,
                plan_date: dateShort, coefficient: r.coefficient, box_type: r.boxTypeName || null,
              });
              toast('План сохранён', 'success'); onSaved?.();
              return true;
            } catch (e) { toast(e.message, 'error'); }
          } }, 'Выбрать')
        : null;
      tbody.append(el('tr', r.coefficient === 0 ? { style: { background: 'rgba(22,163,74,0.10)' } } : {},
        el('td', { style: { whiteSpace: 'nowrap' } }, dateShort),
        el('td', {}, r.warehouseName || '#' + r.warehouseID),
        el('td', {}, r.boxTypeName || '—'),
        el('td', { style: { color: costClass, fontWeight: '600' } }, coefText),
        el('td', {}, r.coefficient === 0 ? 'бесплатно' : r.coefficient > 0 ? 'платная приёмка' : 'недоступно'),
        el('td', {}, pick)));
    }
  }
  const loadBtn = el('button', { class: 'btn btn-sm btn-primary', onClick: loadCoefs }, 'Показать слоты');
  const body = el('div', {},
    el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' } },
      el('div', {},
        el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Склады WB (Ctrl/Cmd — выбрать несколько):'),
        whSel),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, loadBtn)),
    status,
    table);
  loadWarehouses();
  await openModal('ФБО: подобрать склад и дату', body, { primaryLabel: 'Закрыть', onSubmit: () => true });
}

function sdShowWbBarcode(b) {
  const body = el('div', {});
  if (b && b.barcode) body.append(el('div', { style: { marginBottom: '8px' } }, `Штрихкод: ${b.barcode}`));
  if (b && b.file) {
    const img = el('img', { style: { maxWidth: '100%' } });
    img.src = (b.type === 'svg' ? 'data:image/svg+xml;base64,' : 'data:image/png;base64,') + b.file;
    body.append(img);
  } else if (!b || !b.barcode) {
    body.append(el('div', {}, 'WB не вернул штрихкод.'));
  }
  openModal('Штрихкод поставки WB', body);
}

// ---- Книга сетов ----
function renderSdSetsCard() {
  const card = el('div', { class: 'card', style: { marginBottom: '12px' } });
  card.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
    el('h4', {}, 'Книга сетов (артикул маркетплейса + упаковка)'),
    el('div', { style: { display: 'flex', gap: '6px' } },
      el('button', { class: 'btn btn-sm', onClick: () => sdPullMsSetsModal(reload) }, 'Подтянуть из МС'),
      el('button', { class: 'btn btn-sm btn-primary', onClick: () => sdEditSet(null, reload) }, '+ Сет'))));
  card.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' } },
    'Сет = артикул маркетплейса (комбинация артикулов склада) + упаковка/габариты. «Артикул» сета = ключ маппинга с МП (WB=артикул продавца, Ozon=штрихкод, ЯМ=SKU). Канальные SKU сопоставляются с сетом ниже.'));
  const searchI = el('input', { type: 'text', placeholder: 'Поиск сета', style: { width: '220px' } });
  const filterSel = el('select', {}, el('option', { value: 'all' }, 'Все'),
    el('option', { value: 'no_reward' }, 'Без вознаграждения'), el('option', { value: 'no_dims' }, 'Без габаритов'));
  filterSel.addEventListener('change', () => reload());
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: () => reload() }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });
  card.append(el('div', { style: { marginBottom: '8px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, searchI, filterSel, findBtn));
  const tbody = el('tbody', {});
  card.append(el('div', { style: { overflowX: 'auto' } }, el('table', { class: 'table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Сет'), el('th', {}, 'Артикул'), el('th', {}, 'Состав'), el('th', {}, 'Упаковка'),
      el('th', {}, 'Время, мин'), el('th', {}, 'Габариты'), el('th', {}, 'Доход, ₽'), el('th', {}, ''))), tbody)));
  async function reload() {
    tbody.textContent = '';
    let rows = [];
    try { rows = await api.sdSets(searchI.value.trim(), filterSel.value); } catch (e) { toast(e.message, 'error'); return; }
    if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: '8' }, 'Сетов нет'))); return; }
    for (const s of rows) {
      const dims = [s.dim_l, s.dim_w, s.dim_h].every((x) => x == null) ? '—' : `${s.dim_l ?? '?'}×${s.dim_w ?? '?'}×${s.dim_h ?? '?'}`;
      const pkg = Number(s.packaging_count) ? `${s.packaging_summary || '?'} (${s.packaging_count})` : '—';
      const edit = el('button', { class: 'btn btn-sm', onClick: () => sdEditSet(s, reload) }, '✏');
      // Отправить в БОЕВОЙ МойСклад (создать новый комплект или обновить связанный).
      const pushMs = el('button', { class: 'btn btn-sm', style: { marginLeft: '4px' }, title: 'Отправить в МойСклад (создать/обновить комплект)', onClick: async () => {
        if (!(await confirm(s.ms_bundle_id
          ? `Обновить комплект «${s.name}» в БОЕВОМ МойСклад (название/артикул/состав)?`
          : `Создать «${s.name}» как новый комплект в БОЕВОМ МойСклад (папка «Комплект RUS»)?`))) return;
        try { const r = await api.sdPushMsSet(s.id); toast(r.created ? 'Создан комплект в МойСклад' : 'Комплект в МойСклад обновлён', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
      } }, '⬆ МС');
      const del = el('button', { class: 'btn btn-sm btn-danger', style: { marginLeft: '4px' }, onClick: async () => {
        if (!(await confirm(`Удалить сет «${s.name}»?`))) return;
        try { await api.sdDeleteSet(s.id); reload(); } catch (e) { toast(e.message, 'error'); }
      } }, '🗑');
      const nameCell = el('td', {}, s.name, s.ms_bundle_id ? el('span', { class: 'badge ms-badge', style: { marginLeft: '6px' }, title: 'Связан с МойСклад' }, 'МС') : null);
      const inc = Number(s.preliminary_income) || 0;
      const incCell = el('td', { style: { fontWeight: '600', whiteSpace: 'nowrap', color: s.warehouse_reward == null ? 'var(--text-muted)' : (inc >= 0 ? '#16a34a' : '#dc2626') } },
        s.warehouse_reward == null ? '— (нет вознагр.)' : inc.toFixed(2));
      tbody.append(el('tr', {}, nameCell, el('td', {}, s.article || '—'), el('td', {}, String(s.component_count)), el('td', {}, pkg),
        el('td', {}, String(s.packing_time_min ?? 0)), el('td', {}, dims), incCell, el('td', {}, edit, pushMs, del)));
    }
  }
  reload();
  return card;
}

// Подтянуть сеты (комплекты) из МойСклад из указанной папки. Read-only из МС.
// Листаем комплекты постранично (по 100) — чтобы каждый запрос укладывался в лимит
// времени; прогресс показываем в окне.
async function sdPullMsSetsModal(onDone) {
  const folderI = el('input', { type: 'text', value: 'Комплект RUS', style: { width: '100%' } });
  const status = el('div', { style: { fontSize: '13px', marginTop: '6px', minHeight: '18px' } });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Папка комплектов в МойСклад'), folderI),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } },
      'Подтянет комплекты (сеты) из этой папки: название + артикул + состав (компоненты сопоставятся с товарами каталога по МойСклад-id). Листается постранично, может занять время. В МойСклад ничего не пишется.'),
    status);
  await openModal('Подтянуть сеты из МойСклад', body, { primaryLabel: 'Подтянуть', onSubmit: async () => {
    const folder = folderI.value.trim() || 'Комплект RUS';
    let offset = 0; let hasMore = true; let guard = 0; let folderHref = null;
    let created = 0; let updated = 0; let compMapped = 0; let compUnmapped = 0; let matched = 0;
    try {
      while (hasMore && guard < 500) {
        guard += 1;
        const r = await api.sdPullMsSets(folder, offset, folderHref);
        folderHref = folderHref || r.folder_href;
        created += r.created || 0; updated += r.updated || 0;
        compMapped += r.components_mapped || 0; compUnmapped += r.components_unmapped || 0;
        matched += r.matched || 0;
        hasMore = r.has_more; offset = r.next_offset;
        status.textContent = `Обработано ~${offset} позиций папки · сетов: ${matched} (новых ${created}, обновлено ${updated})…`;
      }
      if (!matched) {
        toast(`В папке «${folder}» комплектов (bundle) не найдено. Проверьте, что сеты — именно комплекты и лежат в этой папке.`, 'error');
        return false;
      }
      // Сеты пришли с артикулами — сразу сопоставляем номенклатуру каналов по артикулу
      // сета: WB = артикул продавца, Ozon = штрихкод, ЯМ = SKU.
      status.textContent = 'Сопоставляю каналы по артикулу сета…';
      let autoMatched = 0;
      for (const ch of ['wb', 'ozon', 'ym']) {
        try { const a = await api.sdAutoMatchArticle(ch); autoMatched += a.matched || 0; } catch { /* канал мог быть пуст */ }
      }
      let msg = `Сеты из МС: найдено ${matched} (новых ${created}, обновлено ${updated}). Компонентов связано ${compMapped}`;
      if (autoMatched) msg += `. Сопоставлено с каналами по артикулу: ${autoMatched}`;
      if (compUnmapped) msg += `; не найдено в каталоге ${compUnmapped} (импортируй товары из МойСклад)`;
      toast(msg, compUnmapped ? 'error' : 'success');
      onDone?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdEditSet(setRow, onSaved) {
  const tariffs = await api.sdTariffs().catch(() => []);
  let full = setRow;
  if (setRow) { try { full = await api.sdSet(setRow.id); } catch { full = setRow; } }
  const nameI = el('input', { type: 'text', value: full?.name || '' });
  const articleI = el('input', { type: 'text', value: full?.article || '', placeholder: 'артикул сета (ключ маппинга с МП)' });
  const rewardI = el('input', { type: 'number', min: '0', step: 'any', value: full?.warehouse_reward ?? '', placeholder: '₽ за сет' });
  const timeI = el('input', { type: 'number', min: '0', step: 'any', value: full?.packing_time_min ?? 0 });
  const lI = el('input', { type: 'number', min: '0', step: 'any', value: full?.dim_l ?? '', style: { width: '70px' } });
  const wI = el('input', { type: 'number', min: '0', step: 'any', value: full?.dim_w ?? '', style: { width: '70px' } });
  const hI = el('input', { type: 'number', min: '0', step: 'any', value: full?.dim_h ?? '', style: { width: '70px' } });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Название сета (= артикул МП)'), nameI),
    el('div', { class: 'form-row' }, el('label', {}, 'Артикул сета (WB=артикул продавца, Ozon=штрихкод, ЯМ=SKU)'), articleI),
    full?.ms_bundle_id ? el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' } }, '🔗 Из МойСклад — состав синхронизируется при «Подтянуть из МС».') : null,
    el('div', { class: 'form-row' }, el('label', {}, 'Вознаграждение склада, ₽ (за сет)'), rewardI),
    el('div', { class: 'form-row' }, el('label', {}, 'Время упаковки, мин'), timeI),
    el('div', { class: 'form-row' }, el('label', {}, 'Габариты Д×Ш×В'), el('div', { style: { display: 'flex', gap: '6px' } }, lI, wI, hI)));
  if (full && full.id) {
    // ----- Предварительный доход = вознаграждение − упаковка(вся) − работа(мин×ставка) -----
    const laborRate = Number(full.labor_rate_per_min) || 0;
    const incomeBox = el('div', { style: { marginTop: '8px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border, #e5e7eb)', fontSize: '13px' } });
    function packagingCost() {
      return (full.packaging || []).reduce((s, p) => s + (Number(p.consumption) || 0) * (Number(p.tariff_cost) || 0), 0);
    }
    function recalcIncome() {
      const reward = Number(rewardI.value) || 0;
      const pk = packagingCost();
      const mins = Number(timeI.value) || 0;
      const labor = mins * laborRate;
      const income = reward - pk - labor;
      incomeBox.textContent = '';
      incomeBox.append(
        el('div', { style: { fontWeight: '600', marginBottom: '2px' } }, 'Предварительный доход сета'),
        el('div', {}, `Вознаграждение: ${reward.toFixed(2)} ₽`),
        el('div', {}, `− Упаковка (вся): ${pk.toFixed(2)} ₽`),
        el('div', {}, `− Работа: ${mins} мин × ${laborRate} ₽/мин = ${labor.toFixed(2)} ₽`),
        el('div', { style: { fontWeight: '700', marginTop: '4px', color: income >= 0 ? '#16a34a' : '#dc2626' } }, `= Доход: ${income.toFixed(2)} ₽`),
      );
    }
    rewardI.addEventListener('input', recalcIncome);
    timeI.addEventListener('input', recalcIncome);
    body.append(incomeBox);

    // ----- Упаковка сета: несколько типов (стретч-плёнка + коробка + …) -----
    const packBox = el('div', { style: { marginTop: '10px' } });
    packBox.append(el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Упаковка (можно несколько типов):'));
    const packList = el('div', {});
    packBox.append(packList);
    function renderPack() {
      packList.textContent = '';
      for (const p of (full.packaging || [])) {
        const del = el('button', { class: 'btn btn-sm btn-danger', onClick: async () => {
          try { await api.sdDeleteSetPackaging(full.id, p.id); full.packaging = full.packaging.filter((x) => x.id !== p.id); renderPack(); } catch (e) { toast(e.message, 'error'); }
        } }, '🗑');
        const unit = p.tariff_unit || 'шт';
        const cost = Number(p.tariff_cost) || 0;
        const lineCost = (Number(p.consumption) || 0) * cost;
        packList.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' } },
          el('span', {}, `${p.tariff_name || '—'} · ${p.consumption} ${unit} × ${cost}₽ = ${lineCost.toFixed(2)}₽`), del));
      }
      if (!(full.packaging || []).length) packList.append(el('div', { style: { color: 'var(--text-muted)' } }, 'Упаковка не задана'));
      recalcIncome();
    }
    renderPack();
    packBox.append(el('button', { class: 'btn btn-sm', style: { marginTop: '6px' }, onClick: () => sdAddSetPackagingModal(full.id, tariffs, async () => {
      try { full = await api.sdSet(full.id); renderPack(); } catch { /* */ }
    }) }, '+ Упаковка'));
    body.append(packBox);

    const comps = el('div', { style: { marginTop: '10px' } });
    comps.append(el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Состав (артикулы склада):'));
    const listBox = el('div', {});
    comps.append(listBox);
    function renderComps() {
      listBox.textContent = '';
      for (const c of (full.components || [])) {
        const del = el('button', { class: 'btn btn-sm btn-danger', onClick: async () => {
          try { await api.sdDeleteSetComponent(full.id, c.id); full.components = full.components.filter((x) => x.id !== c.id); renderComps(); } catch (e) { toast(e.message, 'error'); }
        } }, '🗑');
        listBox.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
          el('span', {}, `${c.sku || ''} ${c.name || ''} × ${c.quantity}`), del));
      }
      if (!(full.components || []).length) listBox.append(el('div', { style: { color: 'var(--text-muted)' } }, 'Состав пуст'));
    }
    renderComps();
    comps.append(el('button', { class: 'btn btn-sm', style: { marginTop: '6px' }, onClick: () => sdAddSetComponent(full.id, async () => {
      try { full = await api.sdSet(full.id); renderComps(); } catch { /* */ }
    }) }, '+ Компонент'));
    body.append(comps);

    // ----- Артикулы маркетплейсов (каналы), привязанные к сету -----
    const linksBox = el('div', { style: { marginTop: '10px' } });
    linksBox.append(el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Артикулы на каналах (маркетплейсы):'));
    const linksList = el('div', {});
    linksBox.append(linksList);
    function renderLinks() {
      linksList.textContent = '';
      for (const l of (full.channel_links || [])) {
        const del = el('button', { class: 'btn btn-sm btn-danger', title: 'Отвязать', onClick: async () => {
          try { await api.sdUnmatchChannel(l.id); full.channel_links = full.channel_links.filter((x) => x.id !== l.id); renderLinks(); } catch (e) { toast(e.message, 'error'); }
        } }, '🗑');
        const chLabel = SD_CHANNELS[l.channel] || l.channel;
        const art = l.channel_sku || l.channel_barcode || '—';
        const extra = [l.channel_name, l.legal_entity].filter(Boolean).join(' · ');
        linksList.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' } },
          el('span', {}, el('b', {}, chLabel), ` · ${art}`, extra ? el('span', { style: { color: 'var(--text-muted)' } }, ` · ${extra}`) : null), del));
      }
      if (!(full.channel_links || []).length) linksList.append(el('div', { style: { color: 'var(--text-muted)' } }, 'Пока не привязан ни к одному каналу'));
    }
    renderLinks();
    linksBox.append(el('button', { class: 'btn btn-sm btn-primary', style: { marginTop: '6px' }, onClick: () => sdAddChannelLinkModal(full.id, async () => {
      try { full = await api.sdSet(full.id); renderLinks(); } catch { /* */ }
    }) }, '+ Добавить канал и связь'));
    body.append(linksBox);
  } else {
    body.append(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' } }, 'Упаковку и состав добавишь после создания сета (открой его ✏).'));
  }
  await openModal(setRow ? 'Изменить сет' : 'Новый сет', body, { primaryLabel: 'Сохранить', onSubmit: async () => {
    const payload = {
      name: nameI.value.trim(),
      article: articleI.value.trim() || null,
      warehouse_reward: rewardI.value !== '' ? Number(rewardI.value) : null,
      packing_time_min: Number(timeI.value) || 0,
      dim_l: lI.value !== '' ? Number(lI.value) : null,
      dim_w: wI.value !== '' ? Number(wI.value) : null,
      dim_h: hI.value !== '' ? Number(hI.value) : null,
    };
    if (!payload.name) { toast('Укажите название сета', 'error'); return false; }
    try { if (full && full.id) await api.sdUpdateSet(full.id, payload); else await api.sdCreateSet(payload); toast('Сет сохранён', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// Привязать сет к артикулу маркетплейса конкретного ЗАВЕДЁННОГО канала-юрлица
// (напр. «WB · ИП Иваненко»), а не абстрактного канала: показываем номенклатуру
// именно этого юрлица. Можно выбрать существующий артикул или добавить вручную.
async function sdAddChannelLinkModal(setId, onSaved) {
  let accounts = [];
  try { accounts = await api.sdChannelAccountsLite(); } catch { accounts = []; }
  const acctSel = el('select', {}, ...accounts.map((a) => el('option', { value: String(a.id) }, `${SD_CHANNELS[a.channel] || a.channel} · ${a.legal_entity || ('#' + a.id)}`)));
  const acctById = new Map(accounts.map((a) => [String(a.id), a]));
  const currentAcct = () => acctById.get(acctSel.value) || null;
  const searchI = el('input', { type: 'text', placeholder: 'Поиск артикула канала (ШК/артикул/название)', style: { width: '240px' } });
  const resBox = el('div', { style: { maxHeight: '200px', overflow: 'auto', margin: '6px 0' } });
  let selectedMapId = null;
  const chosen = el('div', { style: { fontWeight: '600', margin: '4px 0' } }, 'Не выбрано');
  async function doSearch() {
    const acct = currentAcct();
    if (!acct) { resBox.textContent = 'Нет заведённых каналов — добавь их в справочнике «Каналы».'; return; }
    resBox.textContent = 'Поиск…';
    let data;
    // Только номенклатура ЭТОГО юрлица (канал + channel_account_id).
    try { data = await api.sdChannelMap(acct.channel, 'all', searchI.value.trim(), acct.id, 'all'); } catch (e) { resBox.textContent = e.message; return; }
    resBox.textContent = '';
    const rows = (data.rows || []).slice(0, 50);
    if (!rows.length) { resBox.textContent = 'Ничего не найдено для этого юрлица. Можно добавить вручную ниже.'; return; }
    for (const m of rows) {
      const label = `${m.channel_sku || m.channel_barcode || '—'} · ${m.channel_name || ''}${m.set_id ? ' (уже привязан)' : ''}`;
      const b = el('button', { class: 'btn btn-sm', style: { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' },
        onClick: () => { selectedMapId = m.id; chosen.textContent = `Выбрано: ${label}`; } }, label);
      resBox.append(b);
    }
  }
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: doSearch }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  acctSel.addEventListener('change', () => { selectedMapId = null; chosen.textContent = 'Не выбрано'; doSearch(); });
  const mBarcode = el('input', { type: 'text', placeholder: 'штрихкод', style: { width: '130px' } });
  const mSku = el('input', { type: 'text', placeholder: 'артикул', style: { width: '130px', marginLeft: '6px' } });
  const mName = el('input', { type: 'text', placeholder: 'название (необяз.)', style: { width: '100%', marginTop: '4px' } });
  const body = el('div', {},
    accounts.length
      ? el('div', { class: 'form-row' }, el('label', {}, 'Канал (юрлицо)'), acctSel)
      : el('div', { style: { color: '#dc2626', marginBottom: '6px' } }, 'Нет заведённых каналов. Открой справочник «Каналы» и добавь канал + юрлицо.'),
    el('div', { style: { display: 'flex', alignItems: 'center', marginTop: '4px' } }, searchI, findBtn),
    chosen, resBox,
    el('div', { style: { borderTop: '1px solid var(--border, #ddd)', paddingTop: '6px', marginTop: '4px' } },
      el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' } }, 'Или добавить артикул вручную (создастся и сразу привяжется к выбранному юрлицу):'),
      el('div', { style: { display: 'flex', alignItems: 'center' } }, mBarcode, mSku), mName));
  if (accounts.length) doSearch();
  await openModal('Добавить канал и связь', body, { primaryLabel: 'Привязать', onSubmit: async () => {
    const acct = currentAcct();
    if (!acct) { toast('Выберите канал (юрлицо)', 'error'); return false; }
    try {
      if (selectedMapId) {
        await api.sdAddSetChannelLink(setId, { channel: acct.channel, channel_account_id: acct.id, map_id: selectedMapId });
      } else if (mBarcode.value.trim() || mSku.value.trim()) {
        await api.sdAddSetChannelLink(setId, { channel: acct.channel, channel_account_id: acct.id, barcode: mBarcode.value.trim() || null, sku: mSku.value.trim() || null, name: mName.value.trim() || null });
      } else {
        toast('Выберите артикул из списка или заполните вручную', 'error'); return false;
      }
      toast('Привязано', 'success'); onSaved?.();
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdAddSetComponent(setId, onSaved) {
  let selected = null;
  const searchI = el('input', { type: 'text', placeholder: 'Поиск товара склада (SKU/название)', style: { width: '240px' } });
  const qtyI = el('input', { type: 'number', min: '0', step: 'any', value: '1', style: { width: '80px', marginLeft: '6px' } });
  const chosen = el('div', { style: { margin: '6px 0', fontWeight: '600' } }, 'Товар не выбран');
  const resBox = el('div', { style: { maxHeight: '220px', overflow: 'auto' } });
  async function doSearch() {
    resBox.textContent = 'Поиск…';
    let rows = [];
    try { rows = await api.sdProductDirectory(searchI.value.trim()); } catch (e) { resBox.textContent = e.message; return; }
    resBox.textContent = '';
    if (!rows.length) { resBox.textContent = 'Ничего не найдено'; return; }
    for (const r of rows.slice(0, 50)) {
      const b = el('button', { class: 'btn btn-sm', style: { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' },
        onClick: () => { selected = r.product_id; chosen.textContent = `Выбрано: ${r.sku || ''} ${r.name || ''}`; } }, `${r.sku || ''} — ${r.name || ''}`);
      resBox.append(b);
    }
  }
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: doSearch }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  // Живой поиск: показываем товары склада сразу и подгружаем по мере ввода.
  let searchTimer = null;
  searchI.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 300); });
  const body = el('div', {}, el('div', { style: { display: 'flex', alignItems: 'center' } }, searchI, findBtn, el('span', { style: { marginLeft: '8px' } }, 'Кол-во'), qtyI), chosen, resBox);
  doSearch(); // сразу подгрузить текущие товары МойСклад (первые 50 по названию)
  await openModal('Добавить компонент', body, { primaryLabel: 'Добавить', onSubmit: async () => {
    if (!selected) { toast('Выберите товар', 'error'); return false; }
    try { await api.sdAddSetComponent(setId, { product_id: selected, quantity: Number(qtyI.value) || 1 }); toast('Добавлено', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// Добавление одного типа упаковки к сету (тариф + расход в его единицах).
async function sdAddSetPackagingModal(setId, tariffs, onSaved) {
  const tarSel = el('select', {}, el('option', { value: '' }, '— тип упаковки —'),
    ...(tariffs || []).map((t) => el('option', { value: String(t.id) }, `${t.name} (${t.cost}₽/${t.unit || 'шт'})`)));
  const consI = el('input', { type: 'number', min: '0', step: 'any', value: '1', style: { width: '110px' } });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Тип упаковки'), tarSel),
    el('div', { class: 'form-row' }, el('label', {}, 'Расход (в ед. тарифа)'), consI),
    (tariffs || []).length ? el('div', {}) : el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, 'Сначала заведи тарифы упаковки в разделе «Финансы → Упаковка».'));
  await openModal('Добавить упаковку', body, { primaryLabel: 'Добавить', onSubmit: async () => {
    if (!tarSel.value) { toast('Выберите тип упаковки', 'error'); return false; }
    try { await api.sdAddSetPackaging(setId, { packaging_tariff_id: Number(tarSel.value), consumption: Number(consI.value) || 0 }); toast('Упаковка добавлена', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

async function sdMatchSetModal(mapId, onSaved) {
  let selected = null;
  const searchI = el('input', { type: 'text', placeholder: 'Поиск сета', style: { width: '240px' } });
  const chosen = el('div', { style: { margin: '6px 0', fontWeight: '600' } }, 'Сет не выбран');
  const resBox = el('div', { style: { maxHeight: '240px', overflow: 'auto' } });
  async function doSearch() {
    resBox.textContent = 'Поиск…';
    let rows = [];
    try { rows = await api.sdSets(searchI.value.trim()); } catch (e) { resBox.textContent = e.message; return; }
    resBox.textContent = '';
    if (!rows.length) { resBox.textContent = 'Сетов нет — сначала заведи их в «Книге сетов»'; return; }
    for (const s of rows.slice(0, 50)) {
      const b = el('button', { class: 'btn btn-sm', style: { display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' },
        onClick: () => { selected = s.id; chosen.textContent = `Выбрано: ${s.name}`; } }, s.name);
      resBox.append(b);
    }
  }
  const findBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '6px' }, onClick: doSearch }, 'Найти');
  searchI.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  const newSetBtn = el('button', { class: 'btn btn-sm btn-primary', style: { marginLeft: '6px' },
    onClick: () => sdQuickCreateSet((row) => { selected = row.id; chosen.textContent = `Выбрано (новый): ${row.name}`; }) }, '+ Новый сет');
  const body = el('div', {}, el('div', { style: { display: 'flex', alignItems: 'center' } }, searchI, findBtn, newSetBtn), chosen, resBox);
  doSearch();
  await openModal('Сопоставить с сетом', body, { primaryLabel: 'Сопоставить', onSubmit: async () => {
    if (!selected) { toast('Выберите сет', 'error'); return false; }
    try { await api.sdMatchChannel(mapId, selected); toast('Сопоставлено', 'success'); onSaved?.(); }
    catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// Быстрое создание сета прямо из окна сопоставления. onCreated получает созданную строку сета.
async function sdQuickCreateSet(onCreated) {
  const nameI = el('input', { type: 'text', placeholder: 'Название сета (= артикул МП)', style: { width: '100%' } });
  const body = el('div', {},
    el('div', { class: 'form-row' }, el('label', {}, 'Название сета'), nameI),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } },
      'Упаковку, состав и габариты можно заполнить позже в «Книге сетов».'));
  await openModal('Новый сет', body, { primaryLabel: 'Создать', onSubmit: async () => {
    const name = nameI.value.trim();
    if (!name) { toast('Укажите название сета', 'error'); return false; }
    try {
      const row = await api.sdCreateSet({ name });
      toast('Сет создан', 'success');
      onCreated?.(row);
    } catch (e) { toast(e.message, 'error'); return false; }
  } });
}

// ============================================================
// Аналитика остатков — оборачиваемость, ABC, dead stock, дефицит
// ============================================================
export async function renderInventoryAnalytics(main) {
  main.innerHTML = '';
  const periodSel = el('select', {},
    el('option', { value: '30' }, '30 дней'),
    el('option', { value: '90', selected: 'selected' }, '90 дней'),
    el('option', { value: '180' }, '180 дней'),
    el('option', { value: '365' }, 'год'));
  const reloadBtn = el('button', { class: 'btn btn-sm', style: { marginLeft: '8px' } }, '🔄 Обновить');
  // Кнопка пересчёта из МС раньше пряталась справа в шапке (за краем экрана
  // на мобиле). Теперь — крупная в отдельной панели под заголовком.
  const forceRefreshBtn = el('button', { class: 'btn btn-primary', style: { fontSize: '15px', padding: '10px 16px' }, title: 'Заново тянуть продажи из МойСклад (без кэша, может занять 5-15 сек)' }, '⚡ Пересчитать продажи из МойСклад');
  const subtitle = el('div', { class: 'page-subtitle' }, 'Оборачиваемость, ABC-классификация, мёртвый сток, дефицит. Данные — по отгруженным/завершённым заказам за выбранный период.');
  const header = el('div', { class: 'page-header' },
    el('div', {},
      el('h1', { class: 'page-title' }, '📊 Аналитика остатков'),
      subtitle),
    el('div', { style: { display: 'flex', alignItems: 'center' } }, periodSel, reloadBtn));
  main.append(header);
  // Крупная кнопка «Пересчитать из МС» — всегда видна, не за краем экрана.
  main.append(el('div', { style: { margin: '8px 0 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, forceRefreshBtn));
  const content = el('div', {}, el('div', { class: 'loading' }, 'Загрузка…'));
  main.append(content);

  async function load(refresh) {
    content.innerHTML = `<div class="loading">${refresh ? 'Тяну продажи из МойСклад (~5-15 сек)…' : 'Считаю остатки и продажи…'}</div>`;
    let data;
    try { data = await api.analyticsInventory(Number(periodSel.value) || 90, refresh); }
    catch (e) { content.innerHTML = ''; content.append(el('div', { class: 'empty' }, 'Ошибка: ' + e.message)); return; }
    render(data);
  }
  periodSel.addEventListener('change', () => load(false));
  reloadBtn.addEventListener('click', () => load(false));
  forceRefreshBtn.addEventListener('click', () => load(true));

  function statCard(label, value, sub, color, onClick) {
    const card = el('div', { class: 'stat-card', style: onClick ? { cursor: 'pointer' } : {} },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value', style: color ? { color } : {} }, value),
      sub ? el('div', { class: 'sub' }, sub) : null);
    if (onClick) {
      card.addEventListener('click', onClick);
      // Hover-подсказка
      card.title = 'Клик — раскрыть подробный список';
    }
    return card;
  }
  // Модалка со списком товаров одной категории (dead/urgent/low/excess/normal/…).
  async function openCategoryModal(title, list, columns) {
    if (!list || !list.length) { toast(`В категории «${title}» товаров нет — это хорошо`, 'success'); return; }
    const tbody = el('tbody', {});
    for (const it of list) {
      const cells = columns.map((c) => el('td', c.style || {}, c.get(it)));
      tbody.append(el('tr', {}, ...cells));
    }
    const body = el('div', {},
      el('div', { style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' } },
        `Всего: ${list.length}`),
      el('div', { style: { overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' } },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', c.thStyle || {}, c.label)))),
          tbody)));
    await openModal(title, body, { primaryLabel: 'Закрыть', size: 'lg', onSubmit: () => true });
  }
  // Колонки для модалок — минимум нужного, чтобы менеджер понял «что делать».
  function fullColumns(kind) {
    const base = [
      { label: 'SKU', get: (r) => r.sku || '—', style: { whiteSpace: 'nowrap' } },
      { label: 'Название', get: (r) => r.name || '—' },
      { label: 'Ост.', get: (r) => Math.round(r.stock), style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: 'Резерв', get: (r) => (r.reserve > 0 ? Math.round(r.reserve) : '—'), style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: 'Стоимость', get: (r) => money(r.stock_value), style: { textAlign: 'right', whiteSpace: 'nowrap', fontWeight: '600' } },
    ];
    if (kind === 'sales') return [...base,
      { label: 'Продано', get: (r) => Math.round(r.qty_sold) + ' шт', style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: 'Выручка', get: (r) => money(r.revenue), style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: '/день', get: (r) => r.avg_daily.toFixed(2), style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: 'Осталось', get: (r) => r.days_left != null ? Math.round(r.days_left) + 'д' : '∞', style: { textAlign: 'right', whiteSpace: 'nowrap', color: '#dc2626', fontWeight: '600' } },
    ];
    if (kind === 'dead') return [...base,
      { label: 'Последняя продажа', get: (r) => r.last_sale ? new Date(r.last_sale).toLocaleDateString('ru-RU') : 'никогда', style: { color: 'var(--text-muted)' } },
    ];
    if (kind === 'excess') return [...base,
      { label: '/день', get: (r) => r.avg_daily.toFixed(2), style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      { label: 'Осталось', get: (r) => Math.round(r.days_left) + ' дн', style: { textAlign: 'right', whiteSpace: 'nowrap', color: '#a16207', fontWeight: '600' } },
    ];
    if (kind === 'abc') return [...base,
      { label: 'ABC', get: (r) => r.abc },
      { label: 'Выручка', get: (r) => money(r.revenue), style: { textAlign: 'right', whiteSpace: 'nowrap', fontWeight: '600' } },
      { label: 'Оборач.', get: (r) => r.turnover_per_year > 900 ? '—' : r.turnover_per_year.toFixed(1) + '×', style: { textAlign: 'right', whiteSpace: 'nowrap' } },
    ];
    return base;
  }
  function money(n) { return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`; }
  function abcBadge(cls) {
    const c = { A: '#16a34a', B: '#2563eb', C: '#a16207', D: '#6b7280' }[cls] || '#6b7280';
    return el('span', { style: { display: 'inline-block', padding: '1px 6px', borderRadius: '4px', background: c, color: 'white', fontSize: '11px', fontWeight: '600' } }, cls);
  }
  function statusBadge(status, text) {
    const map = {
      urgent: '#dc2626', out: '#dc2626', low: '#f59e0b', excess: '#a16207',
      dead: '#6b7280', inactive: '#9ca3af', normal: '#16a34a',
    };
    return el('span', { style: { color: map[status] || '#6b7280', fontSize: '12px', fontWeight: '600' } }, text);
  }

  function render(data) {
    content.innerHTML = '';
    // Подзаголовок: источник продаж + скрытые склады.
    subtitle.innerHTML = '';
    const totalItems = (data.items || []).length;
    const matched = data.sales_matched_count || 0;
    const fromMs = data.sales_items_count || 0;
    let srcLabel;
    if (data.sales_source === 'moysklad' || data.sales_source === 'moysklad_cached') {
      const cached = data.sales_source === 'moysklad_cached';
      srcLabel = `✅ Продажи из МойСклад${cached ? ` (кэш от ${data.sales_generated_at ? new Date(data.sales_generated_at).toLocaleString('ru-RU') : '—'})` : ' (свежие)'} · МС отдал ${fromMs} позиций, сматчено ${matched} из ${totalItems} (UUID: ${data.sales_matched_by_ext || 0}, SKU: ${data.sales_matched_by_sku || 0})`;
    } else {
      srcLabel = '⚠️ Продажи из CRM (МС недоступен) — только Avito-заказы, неполные данные';
    }
    const srcColor = (data.sales_source === 'moysklad' || data.sales_source === 'moysklad_cached') && matched > 0 ? '' : '#dc2626';
    subtitle.append(el('span', { style: { color: srcColor } }, srcLabel),
      data.sales_error ? el('div', { style: { color: '#dc2626', marginTop: '4px' } }, `❌ ${data.sales_error}`) : null,
      (fromMs > 0 && matched === 0 && data.sales_debug)
        ? el('div', { style: { color: '#dc2626', marginTop: '4px', fontSize: '11px' } },
            'МС отдал продажи, но НИ ОДНА позиция не сматчилась. Диагностика:',
            el('div', {}, `МС UUID: ${(data.sales_debug.ms_ids || []).join(', ') || '—'}`),
            el('div', {}, `МС SKU:  ${(data.sales_debug.ms_skus || []).join(', ') || '—'}`),
            el('div', {}, `CRM UUID: ${(data.sales_debug.crm_ids || []).join(', ') || '—'}`),
            el('div', {}, `CRM SKU:  ${(data.sales_debug.crm_skus || []).join(', ') || '—'}`))
        : null,
      (data.hidden_stores || []).length
        ? el('div', { style: { color: 'var(--text-muted)', marginTop: '4px' } },
            `Скрытые склады (не учтены в остатке): ${data.hidden_stores.join(', ')}`)
        : null);
    const s = data.summary;
    // Дашборд-цифры
    content.append(el('div', { class: 'dashboard-grid' },
      statCard('Товаров в каталоге', s.products_total, `${s.products_with_stock} с остатком`),
      statCard('Стоимость склада', money(s.stock_value_total), 'по себестоимости'),
      statCard('Продано за период', money(s.revenue_total), `${Math.round(s.qty_sold_total)} шт`),
      statCard('Оборачиваемость ABC', `${s.turnover_avg_ab.toFixed(1)}×/год`, 'A+B товары; норма 6-12'),
    ));
    // Кликабельные карточки рисков: клик → модалка со списком товаров категории.
    const byStatus = (st) => data.items.filter((x) => x.status === st)
      .sort((a, b) => (b.stock_value || 0) - (a.stock_value || 0));
    const byUrgent = () => data.items.filter((x) => x.status === 'urgent' || x.status === 'out')
      .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
    const byAbc = (cls) => data.items.filter((x) => x.abc === cls)
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    content.append(el('div', { class: 'dashboard-grid' },
      statCard('🚫 Мёртвый сток', s.dead_count, money(s.dead_value) + ' замороженo', s.dead_count > 0 ? '#6b7280' : '',
        s.dead_count > 0 ? () => openCategoryModal(`🚫 Мёртвый сток (${s.dead_count}) — ${money(s.dead_value)}`, byStatus('dead'), fullColumns('dead')) : null),
      statCard('⚠️ Срочно закупить', s.urgent_count, 'закончатся <7 дней', s.urgent_count > 0 ? '#dc2626' : '',
        s.urgent_count > 0 ? () => openCategoryModal(`⚠️ Срочно закупить (${s.urgent_count})`, byUrgent(), fullColumns('sales')) : null),
      statCard('📉 Заканчивается', s.low_count, '<14 дней запаса', s.low_count > 0 ? '#f59e0b' : '',
        s.low_count > 0 ? () => openCategoryModal(`📉 Заканчивается (${s.low_count})`, byStatus('low').sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999)), fullColumns('sales')) : null),
      statCard('📦 Избыток', s.excess_count, money(s.excess_value) + ' >180 дней', s.excess_count > 0 ? '#a16207' : '',
        s.excess_count > 0 ? () => openCategoryModal(`📦 Избыток (${s.excess_count}) — ${money(s.excess_value)}`, byStatus('excess'), fullColumns('excess')) : null),
    ));
    content.append(el('div', { class: 'dashboard-grid' },
      statCard('ABC-A (топ 80%)', s.abc_a_count, 'ключевые товары', '#16a34a',
        s.abc_a_count > 0 ? () => openCategoryModal(`ABC-A: ключевые товары (${s.abc_a_count})`, byAbc('A'), fullColumns('abc')) : null),
      statCard('ABC-B (80-95%)', s.abc_b_count, 'средние', '#2563eb',
        s.abc_b_count > 0 ? () => openCategoryModal(`ABC-B: средние (${s.abc_b_count})`, byAbc('B'), fullColumns('abc')) : null),
      statCard('ABC-C (95-100%)', s.abc_c_count, 'хвост', '',
        s.abc_c_count > 0 ? () => openCategoryModal(`ABC-C: хвост (${s.abc_c_count})`, byAbc('C'), fullColumns('abc')) : null),
      statCard('D (без продаж)', s.abc_d_count, 'мёртвый', '',
        s.abc_d_count > 0 ? () => openCategoryModal(`ABC-D: без продаж (${s.abc_d_count})`, byAbc('D'), fullColumns('dead')) : null),
    ));

    // Рекомендации
    const recBox = el('div', { class: 'card', style: { marginTop: '12px' } },
      el('h3', { style: { marginTop: 0 } }, '💡 Рекомендации'));
    for (const r of (data.recommendations || [])) {
      const color = r.level === 'urgent' ? '#dc2626' : r.level === 'warning' ? '#a16207' : '#0f172a';
      recBox.append(el('div', { style: { padding: '6px 0', color, fontSize: '14px' } }, r.text));
    }
    content.append(recBox);

    // Три топа рядом
    function topCard(title, rows, cols) {
      const box = el('div', { class: 'card' }, el('h3', { style: { marginTop: 0 } }, title));
      if (!rows.length) { box.append(el('div', { class: 'empty' }, 'Пусто — хорошо')); return box; }
      const tbody = el('tbody', {});
      for (const r of rows) {
        const cells = cols.map((c) => el('td', c.style || {}, c.get(r)));
        tbody.append(el('tr', {}, ...cells));
      }
      box.append(el('div', { style: { overflowX: 'auto' } },
        el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {}, c.label)))),
          tbody)));
      return box;
    }
    content.append(el('div', { class: 'dashboard-grid', style: { marginTop: '12px' } },
      topCard('🔥 Топ-10 продаж', data.top_selling, [
        { label: 'Товар', get: (r) => `${r.sku || '—'} ${r.name || ''}`.slice(0, 60) },
        { label: 'Продано', get: (r) => `${Math.round(r.qty_sold)} шт`, style: { whiteSpace: 'nowrap' } },
        { label: 'Выручка', get: (r) => money(r.revenue), style: { whiteSpace: 'nowrap', fontWeight: '600' } },
        { label: 'Ост.', get: (r) => `${Math.round(r.stock)} (${r.days_left != null ? Math.round(r.days_left) + 'дн' : '∞'})`, style: { whiteSpace: 'nowrap' } },
      ]),
      topCard('⚠️ Срочно закупить', data.urgent, [
        { label: 'Товар', get: (r) => `${r.sku || '—'} ${r.name || ''}`.slice(0, 60) },
        { label: 'Ост.', get: (r) => `${Math.round(r.stock)}`, style: { whiteSpace: 'nowrap' } },
        { label: 'Осталось', get: (r) => r.days_left != null ? `${Math.round(r.days_left)} дн` : '—', style: { whiteSpace: 'nowrap', color: '#dc2626', fontWeight: '600' } },
        { label: '/день', get: (r) => r.avg_daily.toFixed(1), style: { whiteSpace: 'nowrap' } },
      ]),
      topCard('🚫 Мёртвый сток', data.dead_stock, [
        { label: 'Товар', get: (r) => `${r.sku || '—'} ${r.name || ''}`.slice(0, 60) },
        { label: 'Ост.', get: (r) => `${Math.round(r.stock)}`, style: { whiteSpace: 'nowrap' } },
        { label: 'Заморожено', get: (r) => money(r.stock_value), style: { whiteSpace: 'nowrap', fontWeight: '600' } },
      ]),
      topCard('📦 Избыток', data.excess, [
        { label: 'Товар', get: (r) => `${r.sku || '—'} ${r.name || ''}`.slice(0, 60) },
        { label: 'Осталось', get: (r) => `${Math.round(r.days_left)} дн`, style: { whiteSpace: 'nowrap', color: '#a16207' } },
        { label: 'Стоимость', get: (r) => money(r.stock_value), style: { whiteSpace: 'nowrap', fontWeight: '600' } },
      ]),
    ));

    // Полная таблица с фильтрами
    const filters = { status: '', abc: '', search: '' };
    const searchI = el('input', { type: 'search', placeholder: 'Поиск по SKU/названию', style: { width: '240px' } });
    const statusS = el('select', {},
      el('option', { value: '' }, 'Все статусы'),
      el('option', { value: 'urgent' }, '⚠️ Срочно'),
      el('option', { value: 'out' }, '🚫 Закончился'),
      el('option', { value: 'low' }, '📉 Заканчивается'),
      el('option', { value: 'dead' }, '🚫 Мёртвый'),
      el('option', { value: 'excess' }, '📦 Избыток'),
      el('option', { value: 'normal' }, '✅ Норма'));
    const abcS = el('select', {},
      el('option', { value: '' }, 'Все ABC'),
      el('option', { value: 'A' }, 'A'),
      el('option', { value: 'B' }, 'B'),
      el('option', { value: 'C' }, 'C'),
      el('option', { value: 'D' }, 'D (без продаж)'));
    let sortBy = 'revenue', sortDir = -1;
    const tableBox = el('div', { style: { overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' } });
    function renderTable() {
      const q = (filters.search || '').toLowerCase();
      const filtered = data.items.filter((x) =>
        (!filters.status || x.status === filters.status) &&
        (!filters.abc || x.abc === filters.abc) &&
        (!q || (x.sku || '').toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q)));
      filtered.sort((a, b) => {
        const av = a[sortBy] ?? -Infinity, bv = b[sortBy] ?? -Infinity;
        return av === bv ? 0 : (av > bv ? sortDir : -sortDir);
      });
      const tbody = el('tbody', {});
      for (const it of filtered.slice(0, 500)) {
        const nameCell = el('td', {}, it.name || '—');
        if (it.is_markdown) nameCell.append(el('span', { style: { marginLeft: '6px', padding: '1px 5px', background: '#f59e0b', color: 'white', borderRadius: '3px', fontSize: '10px' } }, 'УЦЕНКА'));
        if (!it.active) nameCell.append(el('span', { style: { marginLeft: '6px', padding: '1px 5px', background: '#6b7280', color: 'white', borderRadius: '3px', fontSize: '10px' } }, 'НЕАКТИВЕН'));
        const reserveN = Number(it.reserve) || 0;
        tbody.append(el('tr', {},
          el('td', {}, abcBadge(it.abc)),
          el('td', { style: { whiteSpace: 'nowrap' } }, it.sku || '—'),
          nameCell,
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, String(Math.round(it.stock))),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap', color: reserveN > 0 ? '#a16207' : 'var(--text-muted)' } }, reserveN > 0 ? String(Math.round(reserveN)) : '—'),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, money(it.stock_value)),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, String(Math.round(it.qty_sold))),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, money(it.revenue)),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, it.avg_daily.toFixed(2)),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, it.days_left != null ? Math.round(it.days_left) + 'д' : '∞'),
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } }, it.turnover_per_year > 900 ? '—' : it.turnover_per_year.toFixed(1) + '×'),
          el('td', {}, statusBadge(it.status, it.status_text)),
        ));
      }
      if (!filtered.length) tbody.append(el('tr', {}, el('td', { colspan: '12' }, el('div', { class: 'empty' }, 'Ничего не найдено'))));
      tableBox.innerHTML = '';
      function th(label, key) {
        const a = el('th', { style: { cursor: 'pointer', userSelect: 'none' } },
          label + (sortBy === key ? (sortDir < 0 ? ' ↓' : ' ↑') : ''));
        a.addEventListener('click', () => { if (sortBy === key) sortDir = -sortDir; else { sortBy = key; sortDir = -1; } renderTable(); });
        return a;
      }
      tableBox.append(el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'ABC'),
          th('SKU', 'sku'), el('th', {}, 'Название'),
          th('Ост.', 'stock'), th('Резерв', 'reserve'), th('Ст-ть', 'stock_value'),
          th('Продано', 'qty_sold'), th('Выручка', 'revenue'),
          th('/день', 'avg_daily'), th('Осталось', 'days_left'),
          th('Оборач.', 'turnover_per_year'),
          el('th', {}, 'Статус'))),
        tbody));
    }
    searchI.addEventListener('input', () => { filters.search = searchI.value; renderTable(); });
    statusS.addEventListener('change', () => { filters.status = statusS.value; renderTable(); });
    abcS.addEventListener('change', () => { filters.abc = abcS.value; renderTable(); });
    content.append(el('div', { class: 'card', style: { marginTop: '12px' } },
      el('h3', { style: { marginTop: 0 } }, `📋 Все товары (${data.items.length})`),
      el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' } }, searchI, statusS, abcS),
      tableBox));
    renderTable();
  }

  load();
}
