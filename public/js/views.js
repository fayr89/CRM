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
    ],
  },
};

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
