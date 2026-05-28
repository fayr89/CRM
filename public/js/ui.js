// Маленькие DOM-хелперы и переиспользуемые компоненты.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v === false || v == null) continue;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('ru-RU');
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString('ru-RU');
}

export function fmtMoney(amount, currency = 'RUB') {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// --- Переводы для значений из БД (статусы, стадии и т.п.) ---
export const T = {
  status: {
    new: 'Новый',
    contacted: 'Связались',
    qualified: 'Квалифицирован',
    unqualified: 'Отказ',
    converted: 'Сконвертирован',
  },
  source: {
    website: 'Сайт',
    referral: 'Рекомендация',
    cold_call: 'Холодный звонок',
    social: 'Соцсети',
    event: 'Мероприятие',
    advertisement: 'Реклама',
    other: 'Другое',
  },
  stage: {
    new: 'Новая',
    qualified: 'Квалифицирована',
    proposal: 'Предложение',
    negotiation: 'Переговоры',
    won: 'Выиграна',
    lost: 'Проиграна',
  },
  activity_type: {
    call: 'Звонок',
    email: 'Email',
    meeting: 'Встреча',
    task: 'Задача',
  },
  size: {
    small: 'Малая',
    medium: 'Средняя',
    large: 'Большая',
    enterprise: 'Корпорация',
  },
  role: {
    admin: 'Админ',
    manager: 'Менеджер',
    sales: 'Продажник',
    warehouse: 'Склад',
    rop: 'РОП',
    aus: 'АУС',
    finance: 'Фин. управляющий',
  },
  related: {
    contact: 'контакт',
    company: 'компания',
    lead: 'лид',
    deal: 'сделка',
  },
  order_status: {
    waiting_stock: 'Ожидает товара',
    new: 'Новый',
    reserved: 'Зарезервирован',
    shipped: 'Отгружен',
    completed: 'Завершён',
    cancelled: 'Отменён',
  },
  payment_status: {
    pending: 'На подтверждении',
    confirmed: 'Подтверждён',
    rejected: 'Отклонён',
  },
  payment_method: {
    cash: 'Наличные',
    card: 'Карта',
    bank_transfer: 'Банк. перевод',
    other: 'Другое',
  },
  marketplace: {
    wildberries: 'Wildberries',
    ozon: 'Ozon',
    yandex: 'Яндекс.Маркет',
    avito: 'Avito',
    other: 'Другое',
  },
};

export function tr(category, value) {
  if (!value) return '—';
  return T[category]?.[value] || value;
}

export function badge(value, category) {
  return el('span', { class: `badge ${value || ''}` }, category ? tr(category, value) : value || '—');
}

export function toast(message, kind = '') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${kind}` }, message);
  root.append(t);
  setTimeout(() => t.remove(), 3500);
}

// Дружественное «пустое состояние» для таблиц/списков.
// Помогает новичку понять что делать, а не пугает пустым экраном.
export function emptyState({ icon = '📭', title, description, actionLabel, onAction } = {}) {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-icon' }, icon),
    title ? el('div', { class: 'empty-title' }, title) : null,
    description ? el('div', { class: 'empty-desc' }, description) : null,
    actionLabel
      ? el(
          'button',
          { class: 'btn btn-primary', onClick: onAction || (() => {}) },
          actionLabel,
        )
      : null,
  );
}

export function helpBanner(text) {
  return el('div', { class: 'help-banner' }, text);
}

export function greeting(name) {
  const h = new Date().getHours();
  let prefix;
  if (h < 5) prefix = 'Доброй ночи';
  else if (h < 12) prefix = 'Доброе утро';
  else if (h < 18) prefix = 'Добрый день';
  else prefix = 'Добрый вечер';
  return `${prefix}, ${name?.split(' ')[0] || 'коллега'}!`;
}

export function openModal(title, body, { primaryLabel = 'Сохранить', onSubmit, size } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    const footer = el(
      'div',
      { class: 'modal-footer' },
      el('button', { class: 'btn', onClick: () => close(null) }, 'Отмена'),
      onSubmit
        ? el(
            'button',
            {
              class: 'btn btn-primary',
              onClick: async () => {
                try {
                  const result = await onSubmit();
                  if (result !== false) close(result);
                } catch (e) {
                  toast(e.message || 'Ошибка', 'error');
                }
              },
            },
            primaryLabel,
          )
        : null,
    );

    const modal = el(
      'div',
      { class: 'modal', style: size === 'lg' ? { maxWidth: '800px' } : {} },
      el(
        'div',
        { class: 'modal-header' },
        el('h2', { class: 'modal-title' }, title),
        el('button', { class: 'modal-close', onClick: () => close(null) }, '×'),
      ),
      el('div', { class: 'modal-body' }, body),
      footer,
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
    root.append(backdrop);
  });
}

export async function confirm(message) {
  return await openModal('Подтверждение', el('p', {}, message), {
    primaryLabel: 'Подтвердить',
    onSubmit: () => true,
  });
}

// Конструктор формы. `fields` — массив:
//   { name, label, type: 'text'|'number'|'email'|'date'|'textarea'|'select'|'checkbox',
//     options?: [{value,label}], required?, default? }
export function buildForm(fields, initial = {}) {
  const inputs = {};
  const rows = [];

  for (const f of fields) {
    const id = `f-${f.name}`;
    let input;
    const value =
      initial[f.name] != null
        ? initial[f.name]
        : f.default !== undefined
        ? f.default
        : '';

    if (f.type === 'textarea') {
      input = el('textarea', { id, name: f.name }, value || '');
    } else if (f.type === 'select') {
      input = el(
        'select',
        { id, name: f.name },
        ...f.options.map((o) =>
          el(
            'option',
            { value: o.value, selected: String(o.value) === String(value) ? true : false },
            o.label,
          ),
        ),
      );
    } else if (f.type === 'checkbox') {
      input = el('input', { id, name: f.name, type: 'checkbox', checked: value ? true : false });
    } else {
      input = el('input', {
        id,
        name: f.name,
        type: f.type || 'text',
        value: value ?? '',
        step: f.type === 'number' ? 'any' : null,
      });
    }
    inputs[f.name] = { input, field: f };

    rows.push(
      el(
        'div',
        { class: 'form-row' },
        el('label', { for: id }, f.label + (f.required ? ' *' : '')),
        input,
        f.hint ? el('div', { class: 'hint' }, f.hint) : null,
      ),
    );
  }

  let node;
  if (rows.length >= 6) {
    node = el('div', { class: 'form-grid' }, ...rows);
  } else {
    node = el('div', {}, ...rows);
  }

  function getValues() {
    const out = {};
    for (const [name, { input, field }] of Object.entries(inputs)) {
      let val;
      if (field.type === 'checkbox') val = input.checked;
      else if (field.type === 'number') val = input.value === '' ? null : Number(input.value);
      else if (field.type === 'select' && field.numeric) val = input.value === '' ? null : Number(input.value);
      else val = input.value;
      if (val === '' && !field.keepEmpty) val = null;
      out[name] = val;
    }
    return out;
  }
  return { node, getValues };
}

export function paginator(state, onChange) {
  if (!state || state.total === 0) return el('span');
  const totalPages = state.total_pages || 1;
  const page = state.page;
  const jump = el('input', {
    type: 'number',
    min: 1,
    max: totalPages,
    value: page,
    class: 'page-jump',
    onChange: (e) => {
      let p = parseInt(e.target.value, 10);
      if (Number.isNaN(p)) {
        e.target.value = page;
        return;
      }
      p = Math.min(totalPages, Math.max(1, p));
      if (p !== page) onChange(p);
      else e.target.value = page;
    },
  });
  return el(
    'div',
    { class: 'pagination' },
    el('span', {}, `Всего: ${state.total}`),
    el('button', { class: 'btn btn-sm', disabled: page <= 1, title: 'Первая', onClick: () => onChange(1) }, '«'),
    el('button', { class: 'btn btn-sm', disabled: page <= 1, onClick: () => onChange(page - 1) }, '‹'),
    el('span', { class: 'page-info' }, 'стр. ', jump, ` / ${totalPages}`),
    el('button', { class: 'btn btn-sm', disabled: page >= totalPages, onClick: () => onChange(page + 1) }, '›'),
    el('button', { class: 'btn btn-sm', disabled: page >= totalPages, title: 'Последняя', onClick: () => onChange(totalPages) }, '»'),
  );
}
