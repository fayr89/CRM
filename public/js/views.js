import { api } from './api.js';
import {
  T,
  badge,
  buildForm,
  clear,
  confirm,
  el,
  fmtDate,
  fmtDateTime,
  fmtMoney,
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
// Модуль Avida (прямые продажи): заказы и касса
// ============================================================

const MARKETPLACES = [
  { value: '', label: '—' },
  { value: 'Wildberries', label: 'Wildberries' },
  { value: 'Ozon', label: 'Ozon' },
  { value: 'Яндекс.Маркет', label: 'Яндекс.Маркет' },
  { value: 'Avito', label: 'Avito' },
  { value: 'Другое', label: 'Другое' },
];

function itemsEditor(initialItems = []) {
  const wrap = el('div', { class: 'items-editor' });
  const tbody = el('tbody');
  const totalCell = el('td', { colspan: '5', style: { textAlign: 'right' } }, 'Итого: 0 ₽');

  function recalc() {
    let total = 0;
    for (const row of getItems()) total += row.quantity * row.unit_price;
    totalCell.textContent = `Итого: ${total.toLocaleString('ru-RU')} ₽`;
  }

  function addRow(item = {}) {
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
    [qtyI, priceI].forEach((i) => i.addEventListener('input', recalc));
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
      el('td', {}, skuI),
      el('td', {}, nameI),
      el('td', {}, qtyI),
      el('td', {}, priceI),
      el('td', {}, removeBtn),
    );
    row._inputs = { sku: skuI, name: nameI, quantity: qtyI, unit_price: priceI };
    tbody.append(row);
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
      });
    }
    return out;
  }

  const head = el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', {}, 'Артикул'),
      el('th', {}, 'Название'),
      el('th', {}, 'Кол-во'),
      el('th', {}, 'Цена'),
      el('th', {}, ''),
    ),
  );
  const tfoot = el('tfoot', {}, el('tr', {}, totalCell));
  wrap.append(el('table', {}, head, tbody, tfoot));

  const addBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      onClick: () => addRow(),
      style: { marginTop: '8px' },
    },
    '+ Добавить позицию',
  );
  wrap.append(addBtn);

  if (initialItems.length === 0) addRow();
  else initialItems.forEach(addRow);
  recalc();

  return { node: wrap, getItems };
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
  const items = itemsEditor(cur.items || []);

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

  let state = { page: 1, status: '', marketplace: '', search: '' };
  const tableArea = el('div');

  async function reload() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Загрузка…'));
    try {
      const result = await api.list('orders', { ...state, limit: 25 });
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
      tableArea.append(
        el('div', { class: 'card empty' }, 'Заказов нет.'),
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

  const toolbar = el(
    'div',
    { class: 'toolbar' },
    searchInput,
    statusFilter,
    marketFilter,
    el('div', { class: 'spacer' }),
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
      el('h1', { class: 'page-title' }, 'Прямые продажи (Avida)'),
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
    { class: 'data' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
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
      ...(order.items || []).map((it) =>
        el(
          'tr',
          {},
          el('td', {}, it.sku || '—'),
          el('td', {}, it.name),
          el('td', {}, it.quantity),
          el('td', {}, fmtMoney(it.unit_price, order.currency)),
          el('td', {}, fmtMoney(it.line_total, order.currency)),
        ),
      ),
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
      tableArea.append(
        el('div', { class: 'card empty' }, 'Пока нет записей. Нажмите «Добавить» чтобы создать.'),
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
  main.append(el('h1', { class: 'page-title' }, 'Дашборд'));
  const container = el('div');
  main.append(container);

  try {
    const stats = await api.dashboard();
    renderDashboardContent(container, stats);
  } catch (e) {
    container.append(el('div', { class: 'empty' }, `Ошибка: ${e.message}`));
  }
}

function renderDashboardContent(container, stats) {
  const { totals, deals, activities, leads } = stats;

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
      api.list('deals', { limit: 200, open: 'true' }),
    ]);
    clear(body);

    const grid = el('div', { class: 'pipeline' });
    for (const stage of pipeline.stages) {
      const stageDeals = (deals.data || []).filter((d) => d.stage === stage.stage);
      const column = el(
        'div',
        { class: 'pipeline-column' },
        el(
          'div',
          { class: 'pipeline-column-header' },
          el('span', {}, tr('stage', stage.stage)),
          el('span', {}, fmtMoney(stage.total_amount)),
        ),
        ...stageDeals.map((d) =>
          el(
            'div',
            {
              class: 'pipeline-card',
              onClick: () => openDealEdit(d, () => renderPipelineBody(body)),
            },
            el('div', { class: 'title' }, d.title),
            el('div', { class: 'meta' }, fmtMoney(d.amount, d.currency), ' · ', d.probability + '%'),
            el('div', { class: 'meta' }, d.company_name || companyName(d.company_id)),
            el(
              'div',
              { class: 'meta' },
              d.expected_close_date ? `Закрытие: ${fmtDate(d.expected_close_date)}` : '',
            ),
          ),
        ),
      );
      grid.append(column);
    }
    body.append(grid);
    body.append(
      el(
        'div',
        { class: 'card', style: { marginTop: '16px' } },
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
