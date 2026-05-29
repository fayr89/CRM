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

let CACHE = { users: [], companies: [], contacts: [] };

async function loadLookups() {
  try {
    const [users, companies, contacts] = await Promise.all([
      api.list('users', { limit: 200 }).catch(() => ({ data: [] })),
      api.list('companies', { limit: 200 }),
      api.list('contacts', { limit: 200 }),
    ]);
    CACHE.users = users.data || [];
    CACHE.companies = companies.data || [];
    CACHE.contacts = contacts.data || [];
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
      { key: 'name', label: 'Название' },
      { key: 'industry', label: 'Отрасль' },
      { key: 'size', label: 'Размер', render: (r) => (r.size ? tr('size', r.size) : '—') },
      { key: 'annual_revenue', label: 'Выручка', render: (r) => fmtMoney(r.annual_revenue) },
      { key: 'owner_id', label: 'Ответственный', render: (r) => userName(r.owner_id) },
      { key: 'created_at', label: 'Создана', render: (r) => fmtDate(r.created_at) },
    ],
    filters: [
      { key: 'size', type: 'select', options: optsFromT('size'), label: 'Размер' },
      { key: 'industry', type: 'text', label: 'Отрасль' },
    ],
    form: () => [
      { name: 'name', label: 'Название', required: true },
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
        render: (r) => `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`,
      },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Телефон' },
      { key: 'position', label: 'Должность' },
      { key: 'company', label: 'Компания', render: (r) => r.company_name || companyName(r.company_id) },
      { key: 'owner', label: 'Ответственный', render: (r) => userName(r.owner_id) },
    ],
    form: () => [
      { name: 'first_name', label: 'Имя', required: true },
      { name: 'last_name', label: 'Фамилия' },
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
        render: (r) => `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}`,
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
    ],
    form: () => [
      { name: 'first_name', label: 'Имя', required: true },
      { name: 'last_name', label: 'Фамилия' },
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
      { key: 'title', label: 'Название' },
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
    filters: [{ key: 'stage', type: 'select', options: optsFromT('stage'), label: 'Стадия' }],
    form: () => [
      { name: 'title', label: 'Название', required: true },
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
  // Показывает наличие товара по видимым складам под названием позиции.
  function storesText(stockByStore) {
    if (!Array.isArray(stockByStore) || !stockByStore.length) return ''; // склады не загружены
    const sv = computeStoreView(stockByStore, hiddenSet);
    if (!sv.visible.length) return '⚠️ нет в наличии на складах';
    return '📦 ' + sv.visible.map((s) => `${s.store}: ${s.stock}`).join(', ');
  }
  // Обновляет подсказку наличия с учётом заказанного количества (предупреждение, если больше остатка).
  function updateStoresHint(row) {
    const meta = row._meta;
    const i = row._inputs;
    if (!i.storesHint) return;
    const hasStores = Array.isArray(meta.stock_by_store) && meta.stock_by_store.length;
    const total = hasStores ? computeStoreView(meta.stock_by_store, hiddenSet).totalStock : null;
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
    // Проверка наличия: наличие = сумма по видимым складам (если есть), иначе общий остаток.
    const sv = computeStoreView(product.stock_by_store, hiddenSet);
    const hasStores = Array.isArray(product.stock_by_store) && product.stock_by_store.length;
    const available = hasStores ? sv.totalStock : product.stock;
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
                const sv = computeStoreView(p.stock_by_store, hiddenSet);
                const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
                const total = hasStores ? sv.totalStock : p.stock;
                if (total == null) return '';
                return total > 0 ? ` · 📦 ${total} шт` : ' · ⚠️ нет в наличии';
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
              // Наличие по видимым складам (сумма), иначе общий остаток.
              const sv = computeStoreView(p.stock_by_store, hiddenSet);
              const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
              const total = hasStores ? sv.totalStock : p.stock;
              if (total == null) return null;
              return el('div', { class: `popular-card-stock${total <= 0 ? ' out' : ''}` },
                total > 0 ? `📦 ${total} шт` : '⚠️ нет');
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

  return { node: wrap, getItems, refreshCatalogPrices: refreshAll, refreshStocks, applyPriceFactor };
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
                  const sv = computeStoreView(p.stock_by_store, hiddenSet);
                  const hasStores = Array.isArray(p.stock_by_store) && p.stock_by_store.length;
                  const total = hasStores ? sv.totalStock : p.stock;
                  if (total == null) return '';
                  return total > 0 ? ` · 📦 ${total} шт` : ' · ⚠️ нет в наличии';
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

async function openOrderForm(order, onSaved) {
  const isEdit = !!order;
  const cur = order || {};

  // Правила цен (необязательно): проценты по оплате + пороги по сумме.
  // Если бэкенд старый/недоступен — форма работает как раньше, без расчёта прайса.
  let pricing = { payment_methods: [], order_tiers: [] };
  try {
    pricing = await api.pricingSettings();
  } catch {
    /* правила недоступны */
  }
  const paymentMethods = pricing.payment_methods || [];
  const orderTiers = pricing.order_tiers || [];

  // Скрытые склады — чтобы наличие в позициях показывалось только по нужным складам.
  // Список складов + склад списания по умолчанию (из администрирования).
  let hiddenSet = new Set();
  let allWarehouses = [];
  let defaultWarehouse = '';
  let defaultMarketplace = '';
  try {
    const w = await api.warehousesList();
    hiddenSet = new Set(w.hidden || []);
    allWarehouses = (w.all || []).filter((s) => !hiddenSet.has(s));
    defaultWarehouse = w.default_writeoff || '';
    defaultMarketplace = w.default_marketplace || '';
  } catch {
    /* нет настройки — покажем все склады */
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
  const classI = el(
    'select',
    {},
    el('option', { value: 'B2C', selected: (cur.client_classification || 'B2C') === 'B2C' }, 'B2C (физлицо)'),
    el('option', { value: 'B2B', selected: cur.client_classification === 'B2B' }, 'B2B (компания)'),
  );
  const clientI = el('input', { type: 'text', value: cur.client_name || '' });
  const clientPhoneI = el('input', { type: 'tel', value: cur.client_phone || '', placeholder: '+7…' });
  const currencyI = el('input', { type: 'text', value: cur.currency || 'RUB', maxlength: '3', style: { width: '80px' } });
  const notesI = el('textarea', {}, cur.notes || '');
  // Ссылка на диалог Avito — обязательна при площадке Avito.
  const avitoDialogI = el('input', { type: 'url', value: cur.avito_dialog_url || '', placeholder: 'https://www.avito.ru/...' });
  const avitoDialogRow = el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
    el('label', {}, 'Ссылка на диалог Avito *'), avitoDialogI);
  // Номер отправления (трек-номер). Храним в shipment_qr. Обязателен при резерве.
  const qrI = el('input', {
    type: 'text',
    value: (cur.shipment_qr && !String(cur.shipment_qr).startsWith('data:')) ? cur.shipment_qr : '',
    placeholder: 'Номер отправления',
  });
  const deliveryI = el(
    'select',
    {},
    el('option', { value: '' }, '—'),
    ...DELIVERY_METHODS.map((d) => el('option', { value: d, selected: d === cur.delivery_method ? true : false }, d)),
  );
  const deliveryRow = el('div', { class: 'form-row' }, el('label', {}, 'Способ отправки'), deliveryI);

  const payI = paymentMethods.length
    ? el(
        'select',
        {},
        ...paymentMethods.map((m) =>
          el(
            'option',
            { value: m.key, selected: m.key === cur.payment_method ? true : false },
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
  }

  items = itemsEditor(cur.items || [], {
    getMarketplace: () => marketI.value,
    getWarehouse: () => warehouseI.value,
    onChange: renderPricingPanel,
    hiddenSet,
  });
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
    el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'form-row' }, el('label', {}, 'Площадка'), marketI),
      el('div', { class: 'form-row' }, el('label', {}, 'Склад списания'), warehouseI),
      statusI ? el('div', { class: 'form-row' }, el('label', {}, 'Стартовый статус'), statusI) : null,
      el('div', { class: 'form-row' }, el('label', {}, 'Классификация клиента'), classI),
      el('div', { class: 'form-row' }, el('label', {}, 'Клиент / компания'), clientI),
      el('div', { class: 'form-row' }, el('label', {}, 'Телефон клиента'), clientPhoneI),
      payI ? el('div', { class: 'form-row' }, el('label', {}, 'Способ оплаты'), payI) : null,
      deliveryRow,
      el('div', { class: 'form-row' }, el('label', {}, 'Валюта'), currencyI),
      avitoDialogRow,
      el('div', { class: 'form-row', style: { gridColumn: '1 / -1' } },
        el('label', {}, 'Номер отправления'), qrI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    ),
    el('div', { class: 'form-row' }, el('label', {}, 'Позиции заказа *'), items.node),
    pricingPanel,
  );

  renderPricingPanel();

  await openModal(isEdit ? `Заказ #${cur.id}` : 'Новый заказ', body, {
    primaryLabel: isEdit ? 'Сохранить' : 'Создать',
    size: 'lg',
    onSubmit: async () => {
      const orderItems = items.getItems();
      if (orderItems.length === 0) {
        toast('Добавьте хотя бы одну позицию', 'error');
        return false;
      }
      // Валидации новых требований.
      if (marketI.value === 'Avito' && !avitoDialogI.value.trim()) {
        toast('Для Avito укажите ссылку на диалог с клиентом', 'error');
        return false;
      }
      if (classI.value === 'B2B' && (!clientI.value.trim() || !clientPhoneI.value.trim())) {
        toast('Для B2B обязательны имя клиента и телефон', 'error');
        return false;
      }
      const p = computePricing(orderItems);
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
        marketplace: marketI.value || null,
        client_classification: classI.value || null,
        client_name: clientI.value || null,
        client_phone: clientPhoneI.value.trim() || null,
        currency: currencyI.value || 'RUB',
        notes: notesI.value || null,
        items: orderItems,
        payment_method: payI ? payI.value || null : cur.payment_method ?? null,
        price_deviation: p.hasRule ? p.deviation : null,
        recommended_total: p.hasRule ? p.recommendedTotal : null,
        shipment_qr: qrI.value.trim() || null,
        delivery_method: deliveryI.value || null,
        avito_dialog_url: avitoDialogI.value.trim() || null,
        warehouse: warehouseI.value || null,
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

export async function renderOrders(main) {
  await loadLookups();
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isWarehouse = me.role === 'warehouse';
  const isAdmin = me.role === 'admin';
  const canCreate = ['admin', 'manager', 'sales'].includes(me.role);

  let state = { page: 1, status: '', marketplace: '', search: '', view: localStorage.getItem('orders_view') || 'table' };
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      if (state.view === 'kanban') {
        const result = await api.list('orders', { ...state, status: '', limit: 200 });
        renderOrdersKanban(result);
      } else {
        const result = await api.list('orders', { ...state, limit: 25 });
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

    tableArea.append(
      el(
        'div',
        { class: 'help-banner', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
        el('span', {},
          isWarehouse
            ? '💡 Перетаскивайте заказы: «Новый» → «Зарезервирован» → «Отгружен». Клик откроет детали.'
            : '💡 Перетащите отгруженный заказ в «Завершён», чтобы закрыть. Менеджер может отменить новый заказ.',
        ),
        helpButton('kanban'),
      ),
    );

    const grid = el('div', { class: 'pipeline orders-kanban' });
    for (const stage of stages) {
      const stageRows = rows.filter((r) => r.status === stage);
      const total = stageRows.reduce((s, r) => s + (r.total_amount || 0), 0);
      const cardsWrap = el('div', { class: 'pipeline-cards' });
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
        el(
          'div',
          { class: 'pipeline-column-header' },
          el('span', {}, tr('order_status', stage)),
          el('span', {}, `${stageRows.length} · ${fmtMoney(total, 'RUB')}`),
        ),
        cardsWrap,
      );
      if (stageRows.length === 0) {
        cardsWrap.append(el('div', { class: 'pipeline-empty' }, 'Пусто'));
      } else {
        for (const r of stageRows) {
          cardsWrap.append(
            el(
              'div',
              {
                class: 'pipeline-card',
                draggable: 'true',
                onDragstart: (e) => {
                  e.dataTransfer.setData('text/plain', String(r.id));
                  e.dataTransfer.setData('source-status', r.status);
                  e.currentTarget.classList.add('dragging');
                },
                onDragend: (e) => e.currentTarget.classList.remove('dragging'),
                onClick: async () => {
                  const full = await api.get('orders', r.id);
                  await showOrderDetails(full, reload);
                },
              },
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
                el('div', { class: 'title' }, `#${r.id} · ${r.client_name || 'Клиент'}`),
              ),
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
              el('div', { class: 'meta' }, '👤 ' + (r.manager_name || '—') + ' · 📅 ' + fmtDate(r.created_at)),
              r.items_preview
                ? el('div', { class: 'order-card-items', title: r.items_preview }, '📦 ' + r.items_preview)
                : null,
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
      return api.reserveOrder(id);
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
      el('th', {}, 'Площадка'),
      el('th', {}, 'Внеш. №'),
      el('th', {}, 'Клиент'),
      el('th', {}, 'Сумма'),
      el('th', {}, 'Поз.'),
      el('th', {}, 'Статус'),
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Создан'),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    const body = rows.map((r) => {
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
                await api.reserveOrder(r.id);
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
      return el(
        'tr',
        {
          onClick: async () => {
            // Открыть детали заказа
            const full = await api.get('orders', r.id);
            await showOrderDetails(full, reload);
          },
        },
        el('td', {}, `#${r.id}`),
        el('td', {}, r.marketplace || '—'),
        el('td', {}, r.reference_number || '—'),
        el('td', {}, r.client_name || '—'),
        el('td', {}, fmtMoney(r.total_amount, r.currency)),
        el('td', {}, r.items_count),
        el('td', {}, badge(r.status, 'order_status')),
        el('td', {}, r.manager_name || '—'),
        el('td', {}, fmtDateTime(r.created_at)),
        el(
          'td',
          { style: { textAlign: 'right' }, onClick: (e) => e.stopPropagation() },
          ...actions,
        ),
      );
    });

    tableArea.append(
      el(
        'div',
        { class: 'table-wrap' },
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
  const marketFilter = el(
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

  const viewToggle = el(
    'div',
    { class: 'view-toggle' },
    el(
      'button',
      {
        class: 'btn btn-sm' + (state.view === 'table' ? ' active' : ''),
        onClick: () => {
          state.view = 'table';
          localStorage.setItem('orders_view', 'table');
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
          localStorage.setItem('orders_view', 'kanban');
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
            });
            toast('Excel-файл сохранён', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      },
      '⬇ Excel',
    ),
    canCreate
      ? el(
          'button',
          {
            class: 'btn btn-primary',
            onClick: () => openOrderForm(null, reload),
          },
          'Новый заказ',
        )
      : null,
  );

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Продажи с площадок (Avito)'),
        el('div', { class: 'page-subtitle' }, 'Заказы из маркетплейсов и с собственных сайтов'),
      ),
    ),
    el('div', { class: 'help-row' }, helpButton('orders')),
    toolbar,
    tableArea,
  );
  reload();
}

async function showOrderDetails(order, reload) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit =
    (me.role === 'admin' || me.id === order.manager_id) && order.status === 'new';
  // Отменять может: админ/склад (любой активный статус), менеджер-владелец (только новый).
  const canCancel =
    !['completed', 'cancelled'].includes(order.status) &&
    (['admin', 'warehouse'].includes(me.role) || (me.id === order.manager_id && ['new', 'reserved', 'waiting_stock'].includes(order.status)));
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

  const body = el(
    'div',
    {},
    (canCancel || canSplit || canMarkReady || canMarkWaitingFromReserved || canUnreserve || canUnship)
      ? el('div', { style: { marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          canMarkReady
            ? el('button', {
                class: 'btn btn-sm btn-primary',
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
  const state = { managerId: '' };
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
      const [cashbox, payments] = await Promise.all([
        api.cashbox(undefined, state.managerId || undefined),
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
    if (!canFilterByManager) return;
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
          el('div', { class: 'sub' }, `${cashbox.pending.count} транзакций · отклонено ${cashbox.rejected.count}`),
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
      el('th', {}, 'Тип'),
      el('th', {}, 'Сумма'),
      el('th', {}, 'Комиссия'),
      el('th', {}, 'Метод'),
      el('th', {}, 'Заказ'),
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
        el('td', {}, typeLabel),
        el('td', {}, fmtMoney(p.amount, p.currency)),
        el(
          'td',
          {},
          // Для split-расходов (комиссия — отдельной строкой) поле комиссии больше не
          // редактируем — комиссия сама по себе строка. Inline-редактор оставляем только
          // для старых записей и приходов с платформной комиссией.
          isCommissionRow || (p.kind === 'expense' && (p.commission || 0) === 0)
            ? '—'
            : (canConfirm || p.manager_id === me.id)
              ? (() => {
                  const ci = el('input', { type: 'number', min: '0', step: 'any', value: p.commission ?? '', style: { width: '90px' }, placeholder: '—' });
                  ci.addEventListener('change', async () => {
                    try {
                      await api.update('payments', p.id, { commission: ci.value === '' ? null : Number(ci.value) });
                      toast('Комиссия сохранена', 'success');
                    } catch (e) { toast(e.message, 'error'); }
                  });
                  return ci;
                })()
              : (p.commission != null ? fmtMoney(p.commission, p.currency) : '—'),
        ),
        el('td', {}, p.method ? tr('payment_method', p.method) : '—'),
        el('td', {}, p.order_id ? `#${p.order_id}` : (p.reference || '—')),
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
    const commissionI = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0' });
    const methodI = el(
      'select',
      {},
      el('option', { value: '' }, '—'),
      ...Object.entries(T.payment_method).map(([v, l]) =>
        el('option', { value: v }, l),
      ),
    );
    const referenceI = el('input', { type: 'text', placeholder: 'Номер транзакции' });
    const orderI = el('input', { type: 'number', min: '1', step: '1', placeholder: 'ID заказа (необязательно)' });
    const notesI = el('textarea', {});
    const orderDevHint = el('div', { class: 'hint' });

    // Блок «Комиссия + сумма к выводу» — виден только для расхода.
    const commissionRow = el('div', { class: 'form-row' }, el('label', {}, 'Комиссия'), commissionI);
    const payoutHint = el('div', {
      class: 'card',
      style: { padding: '12px', textAlign: 'center', background: '#f0f9ff', border: '1px solid #bae6fd', marginBottom: '8px', display: 'none' },
    });

    function updatePayoutHint() {
      const isExpense = kindI.value === 'expense';
      commissionRow.style.display = isExpense ? '' : 'none';
      const amount = Number(amountI.value) || 0;
      const commission = Number(commissionI.value) || 0;
      if (!isExpense || amount <= 0) {
        payoutHint.style.display = 'none';
        return;
      }
      const payout = amount - commission;
      payoutHint.style.display = '';
      clear(payoutHint);
      if (payout <= 0) {
        payoutHint.style.background = '#fef2f2';
        payoutHint.style.borderColor = '#fecaca';
        payoutHint.append(
          el('div', { style: { color: '#991b1b', fontWeight: 600 } }, '⚠️ Комиссия больше суммы — нечего выводить'),
        );
      } else {
        payoutHint.style.background = '#f0f9ff';
        payoutHint.style.borderColor = '#bae6fd';
        payoutHint.append(
          el('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'Сумма к выводу'),
          el('div', { style: { fontSize: '26px', fontWeight: 700, color: '#0369a1', marginTop: '2px' } }, fmtMoney(payout, 'RUB')),
          commission > 0
            ? el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } },
                `${fmtMoney(amount, 'RUB')} − комиссия ${fmtMoney(commission, 'RUB')} · создадутся 2 транзакции`)
            : el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } }, 'Без комиссии — одна транзакция'),
        );
      }
    }
    kindI.addEventListener('change', updatePayoutHint);
    amountI.addEventListener('input', updatePayoutHint);
    commissionI.addEventListener('input', updatePayoutHint);

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
      commissionRow,
      payoutHint,
      el('div', { class: 'form-row' }, el('label', {}, 'Метод'), methodI),
      el('div', { class: 'form-row' }, el('label', {}, 'Номер транзакции'), referenceI),
      el('div', { class: 'form-row' }, el('label', {}, 'Привязать к заказу (id)'), orderI, orderDevHint),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    );
    // Начальное состояние: приход → комиссия скрыта.
    updatePayoutHint();

    await openModal('Добавить транзакцию', body, {
      primaryLabel: 'Добавить',
      onSubmit: async () => {
        const amount = Number(amountI.value);
        if (!amount || amount <= 0) {
          toast('Укажите сумму', 'error');
          return false;
        }
        const commission = kindI.value === 'expense' && commissionI.value ? Number(commissionI.value) : null;
        if (kindI.value === 'expense' && commission != null && commission >= amount) {
          toast('Комиссия больше или равна сумме', 'error');
          return false;
        }
        await api.create('payments', {
          amount,
          kind: kindI.value,
          // Для прихода комиссия не используется — передаём null
          commission: kindI.value === 'expense' ? commission : null,
          method: methodI.value || null,
          reference: referenceI.value || null,
          order_id: orderI.value ? Number(orderI.value) : null,
          notes: notesI.value || null,
        });
        toast(
          kindI.value === 'expense' && commission ? 'Создано 2 транзакции (вывод + комиссия)' : 'Транзакция добавлена, ждёт подтверждения',
          'success',
        );
        reload();
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

export async function renderResource(main, key) {
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
      const sel = el(
        'select',
        {
          onChange: (e) => {
            state.filters[f.key] = e.target.value || undefined;
            state.page = 1;
            fetchAndRender();
          },
        },
        ...f.options.map((o) => el('option', { value: o.value }, `${f.label}: ${o.label}`)),
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
  const nextDate = r.next_shipping_date ? fmtDateTime(r.next_shipping_date) : '—';
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
  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Воронка продаж'),
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
                renderPipelineBody(body);
              },
            });
          },
        },
        'Новая сделка',
      ),
    ),
  );
  const body = el('div');
  main.append(body);
  renderPipelineBody(body);
}

async function renderPipelineBody(body) {
  clear(body);
  body.append(el('div', { class: 'loading' }, 'Загрузка…'));

  try {
    const [pipeline, deals] = await Promise.all([
      api.pipeline(),
      api.list('deals', { limit: 200 }),
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
    const reload = () => renderPipelineBody(body);

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
  const marketplacesArea = el('div', { class: 'integration-section' });
  const deliveryArea = el('div', { class: 'integration-section' });
  const cancelReasonsArea = el('div', { class: 'integration-section' });
  const warehousesArea = el('div', { class: 'integration-section' });
  const tokensArea = el('div', { class: 'integration-section' });
  const webhooksArea = el('div', { class: 'integration-section' });
  const docsArea = el('div', { class: 'integration-section' });

  main.append(msTokenArea, msSyncArea, maxBotArea, marketplacesArea, deliveryArea, cancelReasonsArea, warehousesArea, tokensArea, webhooksArea, docsArea);

  await renderMoyskladTokenSection(msTokenArea);
  await renderMoyskladSyncSection(msSyncArea);
  await renderMaxBotSection(maxBotArea);
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
    const dangerArea = el('div', { class: 'integration-section' });
    main.append(dangerArea);
    renderDangerZoneSection(dangerArea);
  }
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
  const canEdit = ['admin', 'manager'].includes(me.role);
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
    canEdit
      ? el('button', { class: 'btn', onClick: () => openPriceTemplate() }, '📥 Шаблон прайса')
      : null,
    canEdit
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
  // Список складов для прайса (цена задаётся на канал + склад).
  let priceWarehouses = [];
  try {
    const w = await api.warehousesList();
    const hidden = new Set(w.hidden || []);
    priceWarehouses = (w.all || []).filter((s) => !hidden.has(s));
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
        list.append(
          el(
            'div',
            { class: 'price-row' },
            el('span', { class: 'price-marketplace' }, pp.marketplace + (wh ? ` · ${wh}` : ' · (все склады)')),
            el('span', { class: 'price-value' }, `${pp.price.toLocaleString('ru-RU')} ₽`),
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

    // Форма добавления (канал + склад → цена)
    const newMarketI = el(
      'select',
      {},
      el('option', { value: '' }, 'Площадка…'),
      ...MARKETPLACES.filter((m) => m.value).map((m) =>
        el('option', { value: m.value }, m.label),
      ),
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
          const visible = cur.stock_by_store.filter((s) => (Number(s.stock) || 0) !== 0 || (Number(s.reserve) || 0) !== 0);
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
          pricesArea,
        )
      : el(
          'div',
          { class: 'hint', style: { marginTop: '12px' } },
          'Прайсы по площадкам можно будет добавить после сохранения товара.',
        ),
  );

  if (isEdit) renderPricesEditor();

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
        statusEl.innerHTML = `❌ ${e.message}`;
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
        statusEl.innerHTML = `❌ ${e.message}`;
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
  const channelSel = el(
    'select',
    { class: 'select' },
    el('option', { value: '' }, '— выберите канал —'),
    ...MARKETPLACES.filter((m) => m.value).map((m) => el('option', { value: m.value }, m.label)),
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
      statusEl.innerHTML = `❌ Не удалось прочитать файл: ${e.message}`;
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
        statusEl.innerHTML = `❌ ${e.message}`;
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
        return el('tr', {},
          el('td', {}, '#' + o.id),
          el('td', {}, o.marketplace || '—'),
          el('td', {}, o.client_name || '—'),
          el('td', {}, fmtMoney(o.total_amount, o.currency)),
          el('td', {}, o.cancel_reason || '—'),
          el('td', {}, statusCell),
          actions,
        );
      });
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

  const container = el('div');
  main.append(container);

  async function load() {
    container.replaceChildren(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const [schedule, readyList] = await Promise.all([api.warehouseSchedule(), api.readyToShip()]);
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
          ? next.toLocaleDateString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })
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
  if (orders.length > 0) {
    const selected = new Set();

    const shipSelected = async (ids) => {
      if (!ids.length) {
        toast('Выберите заказы', 'error');
        return;
      }
      if (!(await confirm(`Подтвердить отгрузку ${ids.length} заказов?`))) return;
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
            // Берём id ВЫБРАННЫХ заказов (если есть), иначе ВСЕ reserved
            // в том же порядке как в Excel.
            const ids = selected.size ? [...selected] : orders.map((o) => o.id);
            if (!ids.length) { toast('Нет заказов для печати', 'error'); return; }
            try {
              await api.downloadLabelsPdf(ids);
              toast(`Этикетки сохранены (${ids.length} шт)`, 'success');
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
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Зарезервирован'),
      el('th', {}, 'Сумма'),
    );
    if (canEdit) headRow.append(el('th', {}, 'Действия'));

    const rowsEls = orders.map((o) => {
      const rowEl = el('tr', {
        style: { cursor: 'pointer' },
        onClick: async (e) => {
          // Не открываем детали при клике по интерактивным элементам (чекбокс, кнопки).
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
      rowEl.append(
        el('td', {}, '#' + o.id),
        el('td', {}, o.marketplace || '—'),
        el('td', {}, o.client_name || '—'),
        el('td', {}, o.payment_method || '—'),
        el('td', {}, o.shipment_qr ? el('span', { title: o.shipment_qr }, '✓ есть') : (needQr ? el('span', { class: 'dev-down' }, '✗ нет!') : '—')),
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

    container.append(
      el('h3', { style: { marginTop: '20px' } }, `Заказы к отгрузке (${orders.length})`),
      el(
        'div',
        { class: 'card' },
        actions,
        el(
          'div',
          { class: 'table-wrap' },
          el('table', { class: 'data' }, el('thead', {}, headRow), el('tbody', {}, ...rowsEls)),
        ),
      ),
    );
  }
}

// ============ Обратная связь ============

const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: '🐛 Баг' },
  { value: 'question', label: '❓ Вопрос' },
  { value: 'suggestion', label: '💡 Предложение' },
  { value: 'other', label: '📝 Другое' },
];

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

export async function renderFeedback(main) {
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
    const map = { open: ['Открыто', '#fef3c7', '#92400e'], in_progress: ['В работе', '#dbeafe', '#1e40af'], closed: ['Закрыто', '#dcfce7', '#166534'] };
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
      el('option', { value: 'closed', selected: item.status === 'closed' }, 'Закрыто'),
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
      el('div', { class: 'form-row' }, el('label', {}, 'Статус'), statusSel),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметка / ответ'), replyI),
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
              codeBlock.append(
                el('div', { class: 'card', style: { padding: '16px', textAlign: 'center', marginTop: '12px' } },
                  el('div', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, 'Ваш код привязки:'),
                  el('div', { style: { fontSize: '36px', fontWeight: 700, letterSpacing: '4px', margin: '8px 0', fontFamily: 'monospace' } }, r.code),
                  el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, `Действует ${r.expires_in_minutes || 30} минут`),
                ),
                el('ol', { style: { paddingLeft: '20px', lineHeight: '1.6' } },
                  el('li', {},
                    'Откройте МАХ',
                    r.bot_username
                      ? ` и найдите бота @${r.bot_username}`
                      : ' и найдите нашего бота (имя бота уточните у админа)',
                  ),
                  el('li', {}, 'Отправьте боту: ', el('code', { style: { background: '#f3f4f6', padding: '2px 6px', borderRadius: '3px' } }, `/start ${r.code}`)),
                  el('li', {}, 'Нажмите ниже «🔄 Проверить статус»'),
                ),
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

  area.append(tokenRow, webhookRow, statusBlock, el('div', { style: { marginTop: '8px' } }, testBtn));
}

