// Tiny DOM helpers and reusable components.

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
  return d.toLocaleDateString();
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString();
}

export function fmtMoney(amount, currency = 'USD') {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function badge(value) {
  return el('span', { class: `badge ${value || ''}` }, value || '—');
}

export function toast(message, kind = '') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${kind}` }, message);
  root.append(t);
  setTimeout(() => t.remove(), 3500);
}

export function openModal(title, body, { primaryLabel = 'Save', onSubmit, size } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    const footer = el(
      'div',
      { class: 'modal-footer' },
      el('button', { class: 'btn', onClick: () => close(null) }, 'Cancel'),
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
                  toast(e.message || 'Error', 'error');
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
  return await openModal('Confirm', el('p', {}, message), {
    primaryLabel: 'Confirm',
    onSubmit: () => true,
  });
}

// Build a form. `fields` is an array of:
//   { name, label, type: 'text'|'number'|'email'|'date'|'textarea'|'select'|'checkbox',
//     options?: [{value,label}], required?, default? }
// Returns { node, getValues, setValues }
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

  // 2-col layout when there are 6+ fields
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

// Build a paginator. `state` has { page, total_pages, total }, `onChange(page)`.
export function paginator(state, onChange) {
  if (!state || state.total === 0) return el('span');
  return el(
    'div',
    { class: 'pagination' },
    el('span', {}, `Total: ${state.total}`),
    el(
      'button',
      {
        class: 'btn btn-sm',
        disabled: state.page <= 1 ? true : false,
        onClick: () => onChange(state.page - 1),
      },
      '‹',
    ),
    el('span', {}, `${state.page} / ${state.total_pages}`),
    el(
      'button',
      {
        class: 'btn btn-sm',
        disabled: state.page >= state.total_pages ? true : false,
        onClick: () => onChange(state.page + 1),
      },
      '›',
    ),
  );
}
