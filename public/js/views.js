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
      { name: 'currency', label: 'Валюта', default: 'USD' },
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
        label: 'Менеджер',
        type: 'select',
        numeric: true,
        options: [
          { value: '', label: '— (нет менеджера)' },
          ...CACHE.users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
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

const MARKETPLACES = [
  { value: '', label: '—' },
  { value: 'Wildberries', label: 'Wildberries' },
  { value: 'Ozon', label: 'Ozon' },
  { value: 'Яндекс.Маркет', label: 'Яндекс.Маркет' },
  { value: 'Avito', label: 'Avito' },
  { value: 'Другое', label: 'Другое' },
];

function itemsEditor(initialItems = [], { getMarketplace } = {}) {
  const wrap = el('div', { class: 'items-editor' });
  const tbody = el('tbody');
  const totalCell = el('td', { colspan: '6', style: { textAlign: 'right' } }, 'Итого: 0 ₽');

  function recalc() {
    let total = 0;
    for (const row of getItems()) total += row.quantity * row.unit_price;
    totalCell.textContent = `Итого: ${total.toLocaleString('ru-RU')} ₽`;
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

  function setRowFromProduct(row, product, marketplacePrice) {
    const i = row._inputs;
    i.sku.value = product.sku || '';
    i.name.value = product.name;
    const price = marketplacePrice ?? product.cost_price ?? 0;
    i.unit_price.value = price;
    row._meta.product_id = product.id;
    row._meta.image_url = product.image_url || null;
    row._meta.catalog_price = marketplacePrice ?? null;
    if (product.image_url) {
      i.imageCell.innerHTML = '';
      i.imageCell.append(
        el('img', { src: product.image_url, class: 'item-thumb', alt: '' }),
      );
    } else {
      i.imageCell.innerHTML = '';
      i.imageCell.append(el('div', { class: 'item-thumb item-thumb-empty' }, '—'));
    }
    updatePriceHint(row);
    recalc();
  }

  function addRow(item = {}) {
    const meta = {
      product_id: item.product_id || null,
      image_url: item.image_url || null,
      catalog_price: item.catalog_price ?? null,
    };
    const imageCell = el('td', { class: 'item-image-cell' });
    if (meta.image_url) {
      imageCell.append(el('img', { src: meta.image_url, class: 'item-thumb', alt: '' }));
    } else {
      imageCell.append(el('div', { class: 'item-thumb item-thumb-empty' }, '—'));
    }

    const skuI = el('input', { type: 'text', value: item.sku || '', placeholder: 'Артикул' });
    const nameI = el('input', { type: 'text', value: item.name || '', placeholder: 'Название' });
    const qtyI = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      value: item.quantity || 1,
      style: { width: '70px' },
    });
    const priceI = el('input', {
      type: 'number',
      min: '0',
      step: 'any',
      value: item.unit_price ?? 0,
      style: { width: '100px' },
    });
    const priceHint = el('div', { class: 'price-hint' });

    [qtyI, priceI].forEach((i) => i.addEventListener('input', () => {
      updatePriceHint(row);
      recalc();
    }));

    const pickBtn = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-sm pick-product',
        onClick: async () => {
          const product = await openProductPicker(getMarketplace?.() || '');
          if (product) {
            setRowFromProduct(row, product, product.marketplace_price);
          }
        },
        title: 'Выбрать товар из каталога',
      },
      '📦',
    );

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

    const row = el(
      'tr',
      {},
      imageCell,
      el('td', {}, pickBtn, skuI),
      el('td', {}, nameI),
      el('td', {}, qtyI),
      el('td', {}, priceI, priceHint),
      el('td', {}, removeBtn),
    );
    row._inputs = {
      sku: skuI, name: nameI, quantity: qtyI, unit_price: priceI,
      priceHint, imageCell,
    };
    row._meta = meta;
    tbody.append(row);
    updatePriceHint(row);
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

  // При смене площадки — переподтягиваем catalog_price для уже выбранных товаров,
  // но unit_price НЕ трогаем (если расходится — увидите подсветку).
  async function refreshCatalogPrices() {
    const marketplace = getMarketplace?.() || '';
    for (const row of tbody.children) {
      if (!row._meta.product_id) continue;
      try {
        const r = await api.productsForMarketplace(marketplace, '');
        const p = (r.data || []).find((x) => x.id === row._meta.product_id);
        row._meta.catalog_price = p?.marketplace_price ?? null;
      } catch {
        /* ignore */
      }
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
      el('th', {}, 'Артикул'),
      el('th', {}, 'Название'),
      el('th', {}, 'Кол-во'),
      el('th', {}, 'Цена'),
      el('th', {}, ''),
    ),
  );
  const tfoot = el('tfoot', {}, el('tr', {}, totalCell));

  // --- Блок быстрого добавления: поиск с подсказками + полоса популярных ---

  function addProductRow(product) {
    addRow({
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unit_price: product.marketplace_price ?? product.cost_price ?? 0,
      product_id: product.id,
      image_url: product.image_url,
      catalog_price: product.marketplace_price ?? null,
    });
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
              p.sku ? `Арт: ${p.sku}` : 'Без артикула',
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
        const r = await api.productsForMarketplace(getMarketplace?.() || '', q);
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
        const product = await openProductPicker(getMarketplace?.() || '');
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
      const r = await api.popularProducts(getMarketplace?.() || '', 30);
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

  // При смене площадки — переподтягиваем популярные (цены обновятся) + прайсы выбранных строк.
  async function refreshAll() {
    await Promise.all([refreshCatalogPrices(), refreshPopular()]);
  }

  return { node: wrap, getItems, refreshCatalogPrices: refreshAll };
}

// Пикер товара: открывает модалку со списком, фильтрация по поиску.
// Если задана площадка — показывает цену из её прайса.
async function openProductPicker(marketplace) {
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
        const r = await api.productsForMarketplace(marketplace, searchI.value);
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
  const refI = el('input', { type: 'text', value: cur.reference_number || '', placeholder: 'WB-123456' });
  const marketI = el(
    'select',
    {},
    ...MARKETPLACES.map((m) =>
      el('option', { value: m.value, selected: m.value === cur.marketplace ? true : false }, m.label),
    ),
  );
  const classI = el('input', { type: 'text', value: cur.client_classification || '', placeholder: 'B2B / B2C / VIP / …' });
  const clientI = el('input', { type: 'text', value: cur.client_name || '' });
  const currencyI = el('input', { type: 'text', value: cur.currency || 'RUB', maxlength: '3', style: { width: '80px' } });
  const notesI = el('textarea', {}, cur.notes || '');
  const items = itemsEditor(cur.items || [], {
    getMarketplace: () => marketI.value,
  });
  marketI.addEventListener('change', () => items.refreshCatalogPrices());

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'form-row' }, el('label', {}, 'Номер заказа (с площадки)'), refI),
      el('div', { class: 'form-row' }, el('label', {}, 'Площадка'), marketI),
      el(
        'div',
        { class: 'form-row' },
        el('label', {}, 'Классификация клиента'),
        classI,
      ),
      el('div', { class: 'form-row' }, el('label', {}, 'Клиент'), clientI),
      el('div', { class: 'form-row' }, el('label', {}, 'Валюта'), currencyI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    ),
    el(
      'div',
      { class: 'form-row' },
      el('label', {}, 'Позиции заказа *'),
      items.node,
    ),
  );

  await openModal(isEdit ? `Заказ #${cur.id}` : 'Новый заказ', body, {
    primaryLabel: isEdit ? 'Сохранить' : 'Создать',
    size: 'lg',
    onSubmit: async () => {
      const orderItems = items.getItems();
      if (orderItems.length === 0) {
        toast('Добавьте хотя бы одну позицию', 'error');
        return false;
      }
      const payload = {
        reference_number: refI.value || null,
        marketplace: marketI.value || null,
        client_classification: classI.value || null,
        client_name: clientI.value || null,
        currency: currencyI.value || 'RUB',
        notes: notesI.value || null,
        items: orderItems,
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
    const stages = ['new', 'reserved', 'shipped', 'completed', 'cancelled'];

    tableArea.append(
      el(
        'div',
        { class: 'help-banner' },
        isWarehouse
          ? '💡 Перетаскивайте заказы: «Новый» → «Зарезервирован» → «Отгружен». Клик откроет детали.'
          : '💡 Перетащите отгруженный заказ в «Завершён», чтобы закрыть. Менеджер может отменить новый заказ.',
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
              await transitionOrder(id, src, stage);
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
              el('div', { class: 'meta' }, '👤 ' + (r.manager_name || '—')),
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
      const reason = prompt('Причина отмены (необязательно):') || '';
      return api.cancelOrder(id, reason);
    }
    if (src === 'new' && dst === 'reserved') return api.reserveOrder(id);
    if (src === 'reserved' && dst === 'shipped') return api.shipOrder(id);
    if (src === 'shipped' && dst === 'completed') return api.completeOrder(id);
    throw new Error(
      `Нельзя перевести из «${tr('order_status', src)}» в «${tr('order_status', dst)}». Допустимые шаги: новый→зарезервирован→отгружен→завершён.`,
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
            ? 'Создайте первый заказ кнопкой «Новый заказ» вверху, или подключите внешний сайт через раздел «Интеграции».'
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
              onClick: async (e) => {
                e.stopPropagation();
                const reason = prompt('Причина отмены (необязательно):') || '';
                if (!(await confirm(`Отменить заказ #${r.id}?`))) return;
                await api.cancelOrder(r.id, reason);
                toast('Заказ отменён', 'success');
                reload();
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
        el('h1', { class: 'page-title' }, 'Прямые продажи (Avito)'),
        el('div', { class: 'page-subtitle' }, 'Заказы из маркетплейсов и с собственных сайтов'),
      ),
    ),
    toolbar,
    tableArea,
  );
  reload();
}

async function showOrderDetails(order, reload) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit =
    (me.role === 'admin' || me.id === order.manager_id) && order.status === 'new';

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
        );
      }),
    ),
  );

  const body = el(
    'div',
    {},
    el(
      'div',
      { class: 'detail-grid' },
      el('div', { class: 'k' }, 'Статус'),
      el('div', {}, badge(order.status, 'order_status')),
      el('div', { class: 'k' }, 'Площадка'),
      el('div', {}, order.marketplace || '—'),
      el('div', { class: 'k' }, 'Внешний номер'),
      el('div', {}, order.reference_number || '—'),
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
  const tableArea = el('div');
  const summaryArea = el('div');

  async function reload() {
    clear(summaryArea);
    clear(tableArea);
    summaryArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const [cashbox, payments] = await Promise.all([
        api.cashbox(),
        api.list('payments', { limit: 50 }),
      ]);
      renderSummary(cashbox);
      renderPayments(payments);
    } catch (e) {
      clear(summaryArea);
      summaryArea.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
    }
  }

  function renderSummary(cashbox) {
    clear(summaryArea);
    summaryArea.append(
      el(
        'div',
        { class: 'balance-card' },
        el('div', { class: 'label' }, 'Баланс кассы'),
        el('div', { class: 'value' }, fmtMoney(cashbox.balance, 'RUB')),
        el(
          'div',
          { class: 'sub' },
          `Подтверждено платежей: ${cashbox.confirmed.count} (${fmtMoney(cashbox.confirmed.sum, 'RUB')})  ·  ` +
            `На подтверждении: ${cashbox.pending.count} (${fmtMoney(cashbox.pending.sum, 'RUB')})  ·  ` +
            `Отклонено: ${cashbox.rejected.count}`,
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
      el('th', {}, 'Сумма'),
      el('th', {}, 'Метод'),
      el('th', {}, 'Заказ'),
      el('th', {}, 'Транзакция'),
      el('th', {}, 'Менеджер'),
      el('th', {}, 'Статус'),
      el('th', { style: { textAlign: 'right' } }, 'Действия'),
    );
    const body = rows.map((p) =>
      el(
        'tr',
        {},
        el('td', {}, fmtDateTime(p.created_at)),
        el('td', {}, fmtMoney(p.amount, p.currency)),
        el('td', {}, p.method ? tr('payment_method', p.method) : '—'),
        el('td', {}, p.order_reference ? `#${p.order_id} (${p.order_reference})` : p.order_id ? `#${p.order_id}` : '—'),
        el('td', {}, p.reference || '—'),
        el('td', {}, p.manager_name || '—'),
        el('td', {}, badge(p.status, 'payment_status')),
        el(
          'td',
          { style: { textAlign: 'right' } },
          isAdmin && p.status === 'pending'
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
          isAdmin && p.status === 'pending'
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
      ),
    );
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

    const body = el(
      'div',
      {},
      el('div', { class: 'form-row' }, el('label', {}, 'Сумма *'), amountI),
      el('div', { class: 'form-row' }, el('label', {}, 'Метод'), methodI),
      el('div', { class: 'form-row' }, el('label', {}, 'Номер транзакции'), referenceI),
      el('div', { class: 'form-row' }, el('label', {}, 'Привязать к заказу (id)'), orderI),
      el('div', { class: 'form-row' }, el('label', {}, 'Заметки'), notesI),
    );

    await openModal('Добавить платёж', body, {
      primaryLabel: 'Добавить',
      onSubmit: async () => {
        const amount = Number(amountI.value);
        if (!amount || amount <= 0) {
          toast('Укажите сумму', 'error');
          return false;
        }
        await api.create('payments', {
          amount,
          method: methodI.value || null,
          reference: referenceI.value || null,
          order_id: orderI.value ? Number(orderI.value) : null,
          notes: notesI.value || null,
        });
        toast('Платёж добавлен, ждёт подтверждения', 'success');
        reload();
      },
    });
  }

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Касса'),
      el('button', { class: 'btn btn-primary', onClick: openAddPayment }, 'Добавить платёж'),
    ),
    summaryArea,
    el('h3', { class: 'page-subtitle', style: { marginTop: '16px', marginBottom: '8px' } }, 'Платежи'),
    tableArea,
  );
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
        users: 'Пользователи системы. Чтобы добавить нового — отправьте приглашение через раздел «Приглашения».',
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

  const tipsForRole = {
    admin: 'Вы видите все данные. Раздел «Интеграции» позволяет подключить внешние сайты и Telegram-боты.',
    manager: 'Вы видите данные своих подчинённых. Создавайте сделки и распределяйте задачи.',
    sales: 'Здесь сводка по вашим сделкам и задачам на сегодня. Перетащите сделку на воронке — стадия поменяется.',
    warehouse: 'Откройте раздел «Прямые продажи», переключитесь на канбан и тащите заказы между стадиями.',
  };

  main.append(
    el(
      'div',
      { class: 'greeting-card' },
      el('div', { class: 'greeting-text' }, greeting(me.name)),
      el(
        'div',
        { class: 'greeting-sub' },
        tipsForRole[me.role] || 'Откройте боковое меню — там все разделы CRM.',
      ),
    ),
  );

  const container = el('div');
  main.append(container);

  try {
    const stats = await api.dashboard();
    renderDashboardContent(container, stats, me);
  } catch (e) {
    container.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
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
// Интеграции: API-токены и вебхуки
// ============================================================

export async function renderIntegrations(main) {
  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, 'Интеграции'),
        el('div', { class: 'page-subtitle' }, 'Подключайте внешние сайты, мессенджеры, маркетплейсы — заявки и заказы будут падать прямо в CRM'),
      ),
    ),
  );

  main.append(
    helpBanner(
      '🔌 Создайте токен и передайте его внешнему сервису. Он сможет слать POST на /api/external/leads (заявки) и /api/external/orders (заказы). Webhook наоборот — мы отправим JSON на ваш URL, когда что-то изменится.',
    ),
  );

  const tokensArea = el('div', { class: 'integration-section' });
  const webhooksArea = el('div', { class: 'integration-section' });
  const docsArea = el('div', { class: 'integration-section' });

  main.append(tokensArea, webhooksArea, docsArea);

  await renderTokensSection(tokensArea);
  await renderWebhooksSection(webhooksArea);
  renderDocsSection(docsArea);
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

export async function renderProducts(main) {
  const me = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const canEdit = ['admin', 'manager'].includes(me.role);
  const isAdmin = me.role === 'admin';

  let state = { page: 1, search: '', stock: '' };
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
            el(
              'div',
              { class: 'product-card-pricelists' },
              p.price_count > 0
                ? `${p.price_count} прайс${p.price_count === 1 ? '' : 'а/ов'}`
                : el('span', { class: 'no-prices' }, 'нет прайсов'),
            ),
          ),
          el(
            'div',
            { class: 'product-card-stock' },
            'Остаток: ',
            el('strong', {}, p.stock != null ? String(p.stock) : '—'),
          ),
          Array.isArray(p.stock_by_store) && p.stock_by_store.length
            ? el(
                'div',
                { class: 'product-card-stores' },
                p.stock_by_store.map((s) => `${s.store}: ${s.stock}`).join(', '),
              )
            : null,
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
            el('th', {}, 'Прайсы'),
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
              el('td', {}, p.stock != null ? String(p.stock) : '—'),
              el(
                'td',
                { class: 'stores-cell' },
                Array.isArray(p.stock_by_store) && p.stock_by_store.length
                  ? p.stock_by_store.map((s) => `${s.store}: ${s.stock}`).join(', ')
                  : '—',
              ),
              el(
                'td',
                {},
                p.price_count > 0 ? String(p.price_count) : el('span', { class: 'no-prices' }, 'нет'),
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

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    searchInput,
    stockFilter,
    el('div', { class: 'view-toggle' }, gridBtn, listBtn),
    el('div', { class: 'spacer' }),
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
    helpBanner(
      '💡 Прайс по площадке = цена этого товара для конкретного маркетплейса/лендинга. Когда менеджер создаёт заказ и выбирает товар из каталога — цена подставится автоматически. Менеджер может её поменять — будет видно отклонение.',
    ),
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
        list.append(
          el(
            'div',
            { class: 'price-row' },
            el('span', { class: 'price-marketplace' }, pp.marketplace),
            el('span', { class: 'price-value' }, `${pp.price.toLocaleString('ru-RU')} ₽`),
            el(
              'button',
              {
                type: 'button',
                class: 'btn btn-sm',
                onClick: async () => {
                  if (!(await confirm(`Удалить цену для «${pp.marketplace}»?`))) return;
                  await api.deleteProductPrice(cur.id, pp.marketplace);
                  cur.prices = cur.prices.filter((x) => x.marketplace !== pp.marketplace);
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

    // Форма добавления
    const newMarketI = el(
      'select',
      {},
      el('option', { value: '' }, 'Площадка…'),
      ...MARKETPLACES.filter((m) => m.value).map((m) =>
        el('option', { value: m.value }, m.label),
      ),
    );
    const newPriceI = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'Цена' });
    pricesArea.append(
      el(
        'div',
        { class: 'price-add-row' },
        newMarketI,
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
              await api.setProductPrice(cur.id, {
                marketplace: newMarketI.value,
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
        const parts = [`создано ${r.created}`, `обновлено ${r.updated}`, `всего получено из МойСклад ${r.total}`];
        if (r.skipped) parts.push(`пропущено ${r.skipped}`);
        statusEl.innerHTML = `✅ Готово: ${parts.join(', ')}`;
        if (r.skipped && r.skipped_details?.length) {
          const sample = r.skipped_details.slice(0, 3).map((s) => `• ${s.name}${s.sku ? ` (${s.sku})` : ''}: ${s.error}`).join('<br>');
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
  const tokenI = el('input', { type: 'password', placeholder: 'Bearer-токен МойСклад' });
  const statusEl = el('div', { class: 'import-status' });
  const body = el(
    'div',
    {},
    el('p', {}, 'Быстро обновит только остатки у уже импортированных товаров — без повторной выгрузки каталога. Нужен тот же токен МойСклад.'),
    el('div', { class: 'form-row' }, el('label', {}, 'Токен'), tokenI),
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
    container.append(
      el('h3', { style: { marginTop: '20px' } }, 'Заказы к отгрузке'),
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { style: { marginBottom: '12px' } },
          el(
            'button',
            {
              class: 'btn btn-primary',
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
        ),
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
                el('th', {}, '№'),
                el('th', {}, 'Площадка'),
                el('th', {}, 'Клиент'),
                el('th', {}, 'Менеджер'),
                el('th', {}, 'Зарезервирован'),
                el('th', {}, 'Сумма'),
                el('th', {}, 'Позиций'),
              ),
            ),
            el(
              'tbody',
              {},
              ...orders.map((o) =>
                el(
                  'tr',
                  {},
                  el('td', {}, '#' + o.id),
                  el('td', {}, o.marketplace || '—'),
                  el('td', {}, o.client_name || '—'),
                  el('td', {}, o.manager_name || '—'),
                  el('td', {}, fmtDateTime(o.reserved_at)),
                  el('td', {}, fmtMoney(o.total_amount, o.currency)),
                  el('td', {}, o.items_count),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
