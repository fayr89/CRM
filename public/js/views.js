import { api } from './api.js';
import {
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
    console.warn('Lookup load failed', e);
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

function contactName(id) {
  if (!id) return '—';
  const c = CACHE.contacts.find((x) => x.id === id);
  return c ? `${c.first_name}${c.last_name ? ' ' + c.last_name : ''}` : `#${id}`;
}

// ============================================================
// Resource configurations
// ============================================================

const ENUMS = {
  size: ['small', 'medium', 'large', 'enterprise'],
  lead_source: ['website', 'referral', 'cold_call', 'social', 'event', 'advertisement', 'other'],
  lead_status: ['new', 'contacted', 'qualified', 'unqualified', 'converted'],
  deal_stage: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'],
  activity_type: ['call', 'email', 'meeting', 'task'],
  related_type: ['contact', 'company', 'lead', 'deal'],
  user_role: ['admin', 'manager', 'sales'],
};

const opts = (arr) => [{ value: '', label: '—' }, ...arr.map((v) => ({ value: v, label: v }))];

const RESOURCES = {
  companies: {
    title: 'Companies',
    singular: 'Company',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'industry', label: 'Industry' },
      { key: 'size', label: 'Size' },
      { key: 'annual_revenue', label: 'Revenue', render: (r) => fmtMoney(r.annual_revenue) },
      { key: 'owner_id', label: 'Owner', render: (r) => userName(r.owner_id) },
      { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
    ],
    filters: [
      { key: 'size', type: 'select', options: opts(ENUMS.size), label: 'Size' },
      { key: 'industry', type: 'text', label: 'Industry' },
    ],
    form: () => [
      { name: 'name', label: 'Name', required: true },
      { name: 'industry', label: 'Industry' },
      { name: 'website', label: 'Website' },
      { name: 'email', label: 'Email' },
      { name: 'phone', label: 'Phone' },
      { name: 'size', label: 'Size', type: 'select', options: opts(ENUMS.size) },
      { name: 'annual_revenue', label: 'Annual revenue', type: 'number' },
      {
        name: 'owner_id',
        label: 'Owner',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.users.map((u) => ({ value: u.id, label: u.name }))],
      },
      { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  contacts: {
    title: 'Contacts',
    singular: 'Contact',
    columns: [
      { key: 'name', label: 'Name', render: (r) => `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}` },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'position', label: 'Position' },
      { key: 'company', label: 'Company', render: (r) => r.company_name || companyName(r.company_id) },
      { key: 'owner', label: 'Owner', render: (r) => userName(r.owner_id) },
    ],
    form: () => [
      { name: 'first_name', label: 'First name', required: true },
      { name: 'last_name', label: 'Last name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' },
      { name: 'position', label: 'Position' },
      {
        name: 'company_id',
        label: 'Company',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.companies.map((c) => ({ value: c.id, label: c.name }))],
      },
      {
        name: 'owner_id',
        label: 'Owner',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.users.map((u) => ({ value: u.id, label: u.name }))],
      },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  leads: {
    title: 'Leads',
    singular: 'Lead',
    columns: [
      { key: 'name', label: 'Name', render: (r) => `${r.first_name}${r.last_name ? ' ' + r.last_name : ''}` },
      { key: 'company_name', label: 'Company' },
      { key: 'email', label: 'Email' },
      { key: 'source', label: 'Source' },
      { key: 'status', label: 'Status', render: (r) => badge(r.status) },
      { key: 'estimated_value', label: 'Value', render: (r) => fmtMoney(r.estimated_value) },
      { key: 'owner', label: 'Owner', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'status', type: 'select', options: opts(ENUMS.lead_status), label: 'Status' },
      { key: 'source', type: 'select', options: opts(ENUMS.lead_source), label: 'Source' },
    ],
    form: () => [
      { name: 'first_name', label: 'First name', required: true },
      { name: 'last_name', label: 'Last name' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' },
      { name: 'company_name', label: 'Company' },
      { name: 'position', label: 'Position' },
      { name: 'source', label: 'Source', type: 'select', options: opts(ENUMS.lead_source) },
      { name: 'status', label: 'Status', type: 'select', options: ENUMS.lead_status.map((v) => ({ value: v, label: v })) },
      { name: 'estimated_value', label: 'Estimated value', type: 'number' },
      {
        name: 'owner_id',
        label: 'Owner',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.users.map((u) => ({ value: u.id, label: u.name }))],
      },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
    extraActions: (row, reload) => [
      row.status !== 'converted'
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: async (e) => {
                e.stopPropagation();
                if (!(await confirm(`Convert lead "${row.first_name}" to contact + deal?`))) return;
                try {
                  await api.convertLead(row.id);
                  toast('Lead converted', 'success');
                  reload();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            'Convert',
          )
        : null,
    ],
  },
  deals: {
    title: 'Deals',
    singular: 'Deal',
    columns: [
      { key: 'title', label: 'Title' },
      { key: 'amount', label: 'Amount', render: (r) => fmtMoney(r.amount, r.currency) },
      { key: 'stage', label: 'Stage', render: (r) => badge(r.stage) },
      { key: 'probability', label: 'Prob.', render: (r) => `${r.probability}%` },
      { key: 'expected_close_date', label: 'Close', render: (r) => fmtDate(r.expected_close_date) },
      { key: 'company', label: 'Company', render: (r) => r.company_name || companyName(r.company_id) },
      { key: 'owner', label: 'Owner', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'stage', type: 'select', options: opts(ENUMS.deal_stage), label: 'Stage' },
    ],
    form: () => [
      { name: 'title', label: 'Title', required: true },
      { name: 'amount', label: 'Amount', type: 'number', default: 0 },
      { name: 'currency', label: 'Currency', default: 'USD' },
      { name: 'stage', label: 'Stage', type: 'select', options: ENUMS.deal_stage.map((v) => ({ value: v, label: v })) },
      { name: 'probability', label: 'Probability (%)', type: 'number' },
      { name: 'expected_close_date', label: 'Expected close', type: 'date' },
      {
        name: 'company_id',
        label: 'Company',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.companies.map((c) => ({ value: c.id, label: c.name }))],
      },
      {
        name: 'contact_id',
        label: 'Contact',
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
        label: 'Owner',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.users.map((u) => ({ value: u.id, label: u.name }))],
      },
      { name: 'description', label: 'Description', type: 'textarea' },
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
                if (!(await confirm(`Mark "${row.title}" as won?`))) return;
                await api.winDeal(row.id);
                toast('Deal won', 'success');
                reload();
              },
            },
            'Win',
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
                const reason = prompt('Lost reason (optional):') || '';
                await api.loseDeal(row.id, reason);
                toast('Deal lost', 'success');
                reload();
              },
            },
            'Lose',
          )
        : null,
    ],
  },
  activities: {
    title: 'Activities',
    singular: 'Activity',
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'subject', label: 'Subject' },
      { key: 'due_date', label: 'Due', render: (r) => fmtDateTime(r.due_date) },
      {
        key: 'status',
        label: 'Status',
        render: (r) =>
          r.completed_at
            ? badge('won') // green
            : r.due_date && new Date(r.due_date.replace(' ', 'T') + 'Z') < new Date()
            ? badge('lost') // red overdue
            : badge('new'),
      },
      {
        key: 'related',
        label: 'Related',
        render: (r) => (r.related_to_type ? `${r.related_to_type} #${r.related_to_id}` : '—'),
      },
      { key: 'owner', label: 'Owner', render: (r) => userName(r.owner_id) },
    ],
    filters: [
      { key: 'type', type: 'select', options: opts(ENUMS.activity_type), label: 'Type' },
      {
        key: 'status',
        type: 'select',
        options: [
          { value: '', label: 'All' },
          { value: 'pending', label: 'Pending' },
          { value: 'completed', label: 'Completed' },
        ],
        label: 'Status',
      },
    ],
    form: () => [
      { name: 'type', label: 'Type', type: 'select', required: true, options: ENUMS.activity_type.map((v) => ({ value: v, label: v })) },
      { name: 'subject', label: 'Subject', required: true },
      { name: 'due_date', label: 'Due date', type: 'datetime-local' },
      { name: 'related_to_type', label: 'Related to', type: 'select', options: opts(ENUMS.related_type) },
      { name: 'related_to_id', label: 'Related ID', type: 'number' },
      {
        name: 'owner_id',
        label: 'Owner',
        type: 'select',
        numeric: true,
        options: [{ value: '', label: '—' }, ...CACHE.users.map((u) => ({ value: u.id, label: u.name }))],
      },
      { name: 'description', label: 'Description', type: 'textarea' },
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
                toast('Activity completed', 'success');
                reload();
              },
            },
            'Complete',
          )
        : null,
    ],
  },
  users: {
    title: 'Users',
    singular: 'User',
    columns: [
      { key: 'email', label: 'Email' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role', render: (r) => badge(r.role) },
      { key: 'active', label: 'Active', render: (r) => (r.active ? '✓' : '—') },
      { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
    ],
    form: (editing) => [
      { name: 'email', label: 'Email', type: 'email', required: !editing },
      { name: 'name', label: 'Name', required: !editing },
      {
        name: 'password',
        label: editing ? 'New password (leave blank to keep)' : 'Password',
        type: 'password',
        required: !editing,
      },
      { name: 'role', label: 'Role', type: 'select', options: ENUMS.user_role.map((v) => ({ value: v, label: v })) },
    ],
  },
};

// ============================================================
// Generic resource view
// ============================================================

export async function renderResource(main, key) {
  await loadLookups();
  const cfg = RESOURCES[key];
  if (!cfg) return main.append(el('div', {}, 'Unknown resource'));

  let state = { page: 1, search: '', filters: {} };

  const tableArea = el('div');

  function reload() {
    fetchAndRender();
  }

  async function fetchAndRender() {
    clear(tableArea);
    tableArea.append(el('div', { class: 'loading' }, 'Loading…'));
    try {
      const query = { page: state.page, limit: 25, ...state.filters };
      if (state.search) query.search = state.search;
      const result = await api.list(key, query);
      renderTable(result);
    } catch (e) {
      clear(tableArea);
      tableArea.append(el('div', { class: 'empty' }, `Error: ${e.message}`));
    }
  }

  function renderTable(result) {
    clear(tableArea);
    const rows = result.data || [];
    if (rows.length === 0) {
      tableArea.append(el('div', { class: 'card empty' }, 'No records yet. Click “New” to create one.'));
      return;
    }
    const head = el(
      'tr',
      {},
      ...cfg.columns.map((c) => el('th', {}, c.label)),
      el('th', { style: { textAlign: 'right' } }, 'Actions'),
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
                if (!(await confirm(`Delete this ${cfg.singular.toLowerCase()}?`))) return;
                try {
                  await api.remove(key, row.id);
                  toast('Deleted', 'success');
                  reload();
                } catch (e) {
                  toast(e.message, 'error');
                }
              },
            },
            'Delete',
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
    await openModal(`Edit ${cfg.singular}`, node, {
      primaryLabel: 'Save',
      size: fields.length >= 6 ? 'lg' : undefined,
      onSubmit: async () => {
        const data = getValues();
        // Drop empty password on edit
        if ('password' in data && !data.password) delete data.password;
        await api.update(key, row.id, data);
        toast('Saved', 'success');
        reload();
      },
    });
  }

  async function openCreate() {
    const fields = cfg.form(false);
    const { node, getValues } = buildForm(fields, {});
    await openModal(`New ${cfg.singular}`, node, {
      primaryLabel: 'Create',
      size: fields.length >= 6 ? 'lg' : undefined,
      onSubmit: async () => {
        await api.create(key, getValues());
        toast('Created', 'success');
        reload();
      },
    });
  }

  // Header
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Search…',
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
    el('button', { class: 'btn btn-primary', onClick: openCreate }, 'New'),
  );

  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('div', {}, el('h1', { class: 'page-title' }, cfg.title)),
    ),
    toolbar,
    tableArea,
  );

  fetchAndRender();
}

// ============================================================
// Dashboard
// ============================================================

export async function renderDashboard(main) {
  await loadLookups();
  main.append(el('h1', { class: 'page-title' }, 'Dashboard'));
  const container = el('div');
  main.append(container);

  try {
    const stats = await api.dashboard();
    renderDashboardContent(container, stats);
  } catch (e) {
    container.append(el('div', { class: 'empty' }, `Error: ${e.message}`));
  }
}

function renderDashboardContent(container, stats) {
  const { totals, deals, activities, leads } = stats;

  container.append(
    el(
      'div',
      { class: 'dashboard-grid' },
      statCard('Companies', totals.companies),
      statCard('Contacts', totals.contacts),
      statCard('Leads', totals.leads),
      statCard('Deals', totals.deals),
    ),
    el(
      'div',
      { class: 'dashboard-grid' },
      statCard('Pipeline value', fmtMoney(deals.pipeline_value)),
      statCard('Weighted pipeline', fmtMoney(deals.weighted_pipeline_value)),
      statCard('Win rate', `${(deals.win_rate * 100).toFixed(0)}%`, `${deals.won.count} won / ${deals.lost.count} lost`),
      statCard('Activities', `${activities.upcoming} upcoming`, `${activities.overdue} overdue`),
    ),
  );

  const leadsByStatus = leads?.by_status || [];
  const dealsByStage = deals?.by_stage || [];

  container.append(
    el(
      'div',
      { class: 'dashboard-section' },
      el('h3', {}, 'Leads by status'),
      el('div', { class: 'card' }, ...renderBars(leadsByStatus, 'status', 'count')),
    ),
    el(
      'div',
      { class: 'dashboard-section' },
      el('h3', {}, 'Deals by stage'),
      el('div', { class: 'card' }, ...renderBars(dealsByStage, 'stage', 'count')),
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
  if (!rows.length) return [el('div', { class: 'empty' }, 'No data')];
  const max = Math.max(...rows.map((r) => r[valueKey] || 0)) || 1;
  return rows.map((r) =>
    el(
      'div',
      { class: 'bar-row' },
      el('div', { class: 'name' }, r[labelKey]),
      el('div', { class: 'bar' }, el('div', { style: { width: `${((r[valueKey] || 0) / max) * 100}%` } })),
      el('div', { class: 'count' }, r[valueKey] || 0),
    ),
  );
}

// ============================================================
// Pipeline (kanban)
// ============================================================

export async function renderPipeline(main) {
  await loadLookups();
  main.append(
    el(
      'div',
      { class: 'page-header' },
      el('h1', { class: 'page-title' }, 'Sales Pipeline'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: async () => {
            const cfg = RESOURCES.deals;
            const { node, getValues } = buildForm(cfg.form(false), {});
            await openModal('New deal', node, {
              primaryLabel: 'Create',
              size: 'lg',
              onSubmit: async () => {
                await api.create('deals', getValues());
                toast('Created', 'success');
                renderPipelineBody(body);
              },
            });
          },
        },
        'New deal',
      ),
    ),
  );
  const body = el('div');
  main.append(body);
  renderPipelineBody(body);
}

async function renderPipelineBody(body) {
  clear(body);
  body.append(el('div', { class: 'loading' }, 'Loading…'));

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
          el('span', {}, stage.stage.toUpperCase()),
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
            el('div', { class: 'meta' }, d.expected_close_date ? `Close: ${fmtDate(d.expected_close_date)}` : ''),
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
        el('strong', {}, 'Pipeline value: '),
        fmtMoney(pipeline.pipeline_value),
        ' · ',
        el('strong', {}, 'Weighted: '),
        fmtMoney(pipeline.weighted_pipeline_value),
      ),
    );
  } catch (e) {
    clear(body);
    body.append(el('div', { class: 'empty' }, `Error: ${e.message}`));
  }
}

async function openDealEdit(deal, onSaved) {
  const cfg = RESOURCES.deals;
  const { node, getValues } = buildForm(cfg.form(true), deal);
  await openModal(`Edit deal: ${deal.title}`, node, {
    primaryLabel: 'Save',
    size: 'lg',
    onSubmit: async () => {
      await api.update('deals', deal.id, getValues());
      toast('Saved', 'success');
      onSaved?.();
    },
  });
}
