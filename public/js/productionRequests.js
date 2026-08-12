// Раздел «🛠 Просчёты производства».
// Канбан + модалки. Отдельный файл от views.js.

import { api, getStoredUser } from './api.js';
import { clear, el, fmtDateTime, fmtDate, fmtMoney, toast, openModal } from './ui.js';

const STATUSES = [
  { key: 'draft', label: '📝 Черновик', color: '#94a3b8' },
  { key: 'awaiting_cost', label: '🧮 На просчёте', color: '#3b82f6' },
  { key: 'priced', label: '💰 Просчитано', color: '#8b5cf6' },
  { key: 'negotiating', label: '🔁 Торг', color: '#f59e0b' },
  { key: 'approved', label: '✅ Согласовано', color: '#22c55e' },
  { key: 'awaiting_payment', label: '⌛ Ждёт оплаты', color: '#ea580c' },
  { key: 'in_progress', label: '🛠 В работе', color: '#06b6d4' },
  { key: 'fulfilled', label: '📦 Выполнено', color: '#059669' },
  { key: 'paid', label: '💵 Выплачено', color: '#166534' },
];
const TERMINAL_HIDDEN = ['cancelled', 'rejected']; // отдельная вкладка «Отменённые»

const PROD_ROLES = ['director_prod', 'foreman'];
const isProd = (u) => PROD_ROLES.includes(u.role);
const isAdmin = (u) => u.role === 'admin' || u.role === 'rop';
const isFullAccess = (u) => isAdmin(u) || isProd(u);

export async function renderProductionRequests(main) {
  const user = getStoredUser() || {};
  main.append(
    el('div', { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, '🛠 Просчёты производства'),
        el('div', { class: 'page-subtitle' },
          isProd(user)
            ? 'Заявки менеджеров на просчёт. Заполните себестоимость, конечную цену и вознаграждение менеджера.'
            : isAdmin(user)
              ? 'Заявки менеджеров на просчёт. Полный доступ к финансам и выплатам.'
              : 'Ваши заявки на просчёт производству. После просчёта — согласование с клиентом.',
        ),
      ),
      // Кнопка «Новая заявка» только для менеджера/admin.
      (user.role === 'admin' || ['manager', 'sales', 'rop'].includes(user.role))
        ? el('button', { class: 'btn btn-primary', onClick: () => openCreateModal(() => reload()) }, '+ Новая заявка')
        : null,
    ),
  );

  const showCancelledToggle = el('label', { style: { fontSize: '13px', color: '#6b7280', marginBottom: '8px', display: 'inline-block' } },
    el('input', { type: 'checkbox' }), ' показать отменённые/отклонённые',
  );
  const kanban = el('div', {});
  main.append(showCancelledToggle, kanban);

  let allRequests = [];
  let showCancelled = false;

  async function reload() {
    try {
      const r = await api.prList();
      allRequests = r.requests || [];
      renderKanban();
    } catch (e) { kanban.textContent = 'Ошибка: ' + e.message; }
  }
  function renderKanban() {
    clear(kanban);
    const cols = showCancelled
      ? [...STATUSES, { key: 'cancelled', label: '❌ Отменено', color: '#f87171' }, { key: 'rejected', label: '🚫 Отклонено', color: '#dc2626' }]
      : STATUSES;
    const board = el('div', {
      style: { display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(220px, 1fr))`, gap: '8px', overflowX: 'auto' },
    });
    for (const s of cols) {
      const items = allRequests.filter((r) => r.status === s.key);
      const col = el('div', {
        style: { background: '#f9fafb', borderRadius: '6px', padding: '8px', minHeight: '200px' },
      },
        el('div', { style: { fontWeight: '600', fontSize: '13px', color: s.color, marginBottom: '6px' } }, `${s.label} (${items.length})`),
      );
      for (const req of items) col.append(renderKanbanCard(req, () => reload()));
      board.append(col);
    }
    kanban.append(board);
  }

  showCancelledToggle.querySelector('input').addEventListener('change', (e) => {
    showCancelled = e.target.checked;
    renderKanban();
  });

  await reload();
}

function clientText(req) {
  if (req.company_name) return req.company_name;
  const p = [req.contact_first, req.contact_last].filter(Boolean).join(' ');
  return p || '—';
}

function renderKanbanCard(req, onDone) {
  const user = getStoredUser() || {};
  const card = el('div', {
    style: {
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
      padding: '8px', marginBottom: '6px', cursor: 'pointer',
      boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    },
    onClick: () => openViewModal(req.id, onDone),
  });
  card.append(
    el('div', { style: { fontWeight: '600', fontSize: '13px' } }, req.title),
    el('div', { style: { fontSize: '11px', color: '#6b7280', marginTop: '2px' } }, '👤 ' + clientText(req)),
  );
  // Финансовая строка — что показывать зависит от роли.
  if (req.client_price != null) {
    const price = Number(req.client_price);
    card.append(el('div', { style: { fontSize: '12px', marginTop: '4px', color: '#059669', fontWeight: '600' } },
      `Клиенту: ${fmtMoney(price, 'RUB')}`,
    ));
    if (req.reward_computed != null) {
      card.append(el('div', { style: { fontSize: '11px', color: '#3b82f6' } },
        `Ваше: ${fmtMoney(Number(req.reward_computed), 'RUB')}`,
      ));
    }
    // Cost видит только производство/admin.
    if (isFullAccess(user) && req.cost_price != null) {
      const cost = Number(req.cost_price);
      const margin = price - cost;
      card.append(el('div', { style: { fontSize: '11px', color: '#9ca3af' } },
        `Себест: ${fmtMoney(cost, 'RUB')} · маржа ${fmtMoney(margin, 'RUB')}`,
      ));
    }
  }
  const foot = [];
  if (req.manager_name) foot.push('👤 ' + req.manager_name);
  if (req.files_count) foot.push(`📎 ${req.files_count}`);
  if (req.deadline) foot.push('⏰ ' + fmtDate(req.deadline));
  if (foot.length) card.append(el('div', { style: { fontSize: '11px', color: '#9ca3af', marginTop: '4px' } }, foot.join(' • ')));
  return card;
}

// ============================================================
// МОДАЛКА: создание заявки
// ============================================================
function openCreateModal(onDone) {
  const titleI = el('input', { type: 'text', style: { width: '100%', padding: '8px' }, placeholder: 'Например: «Кухонный гарнитур на дачу 4×2 м»' });
  const descI = el('textarea', { rows: 5, style: { width: '100%', padding: '8px' }, placeholder: 'Что нужно сделать. Материалы, размеры, особенности. Всё что знаете от клиента.' });
  const dlI = el('input', { type: 'date', style: { padding: '8px' } });

  // Клиент — поиск по contacts/companies + быстрое добавление inline.
  const clientSearch = el('input', { type: 'text', style: { flex: 1, padding: '8px' }, placeholder: 'Ищите: имя контакта или название компании…' });
  const quickAddBtn = el('button', {
    class: 'btn', type: 'button', style: { padding: '8px 12px', whiteSpace: 'nowrap' },
    onClick: () => openQuickClientCreate((client) => {
      chosen = client.contact_id ? { contact_id: client.contact_id, company_id: null } : { contact_id: null, company_id: client.company_id };
      clientSelected.textContent = '✓ Выбран: ' + client.label;
      clientSelected.style.display = 'block';
      clientMatches.style.display = 'none';
      clientSearch.value = client.label;
    }),
  }, '+ Быстро');
  const clientSearchRow = el('div', { style: { display: 'flex', gap: '6px' } }, clientSearch, quickAddBtn);
  const clientHint = el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' } }, 'Клиент обязателен. Если нет в базе — жми «+ Быстро», введи минимум полей.');
  const clientMatches = el('div', { style: { maxHeight: '150px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '4px', marginTop: '4px', display: 'none' } });
  const clientSelected = el('div', { style: { padding: '6px', background: '#dcfce7', borderRadius: '4px', marginTop: '4px', display: 'none' } });
  let chosen = { contact_id: null, company_id: null };

  let searchTimer = null;
  clientSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = clientSearch.value.trim();
    if (q.length < 2) { clientMatches.style.display = 'none'; return; }
    searchTimer = setTimeout(async () => {
      try {
        // Ищем и в контактах, и в компаниях.
        const [contacts, companies] = await Promise.all([
          api.list ? api.list('contacts', { search: q, limit: 10 }) : fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=10`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('crm_token') } }).then(r => r.json()),
          api.list ? api.list('companies', { search: q, limit: 10 }) : fetch(`/api/companies?search=${encodeURIComponent(q)}&limit=10`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('crm_token') } }).then(r => r.json()),
        ]);
        clear(clientMatches);
        clientMatches.style.display = 'block';
        const contactsList = contacts.data || contacts.items || [];
        const companiesList = companies.data || companies.items || [];
        if (!contactsList.length && !companiesList.length) {
          clientMatches.append(el('div', { style: { padding: '6px', color: '#9ca3af', fontSize: '13px' } }, 'Не найдено. Добавьте клиента в «Контакты» или «Компании» и вернитесь сюда.'));
          return;
        }
        for (const c of contactsList) {
          const label = `👤 ${c.first_name || ''} ${c.last_name || ''}`.trim() + (c.phone ? ' · ' + c.phone : '');
          clientMatches.append(el('div', {
            style: { padding: '6px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
            onClick: () => {
              chosen = { contact_id: c.id, company_id: null };
              clientSelected.textContent = '✓ Выбран: ' + label;
              clientSelected.style.display = 'block';
              clientMatches.style.display = 'none';
              clientSearch.value = label;
            },
          }, label));
        }
        for (const c of companiesList) {
          const label = `🏢 ${c.name}`;
          clientMatches.append(el('div', {
            style: { padding: '6px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
            onClick: () => {
              chosen = { contact_id: null, company_id: c.id };
              clientSelected.textContent = '✓ Выбрана: ' + label;
              clientSelected.style.display = 'block';
              clientMatches.style.display = 'none';
              clientSearch.value = label;
            },
          }, label));
        }
      } catch (e) { /* ignore */ }
    }, 250);
  });

  // Файлы.
  const filesInput = el('input', { type: 'file', multiple: true });
  const filesList = el('div', { style: { fontSize: '12px', marginTop: '4px' } });
  let filesData = []; // {filename, mime, data_base64}

  filesInput.addEventListener('change', async () => {
    const files = Array.from(filesInput.files || []);
    for (const f of files) {
      if (filesData.length >= 10) { toast('Максимум 10 файлов', 'error'); break; }
      if (f.size > 10 * 1024 * 1024) { toast(`${f.name}: больше 10 МБ`, 'error'); continue; }
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      filesData.push({ filename: f.name, mime: f.type, data_base64: b64 });
    }
    renderFilesList();
    filesInput.value = '';
  });
  function renderFilesList() {
    clear(filesList);
    for (let i = 0; i < filesData.length; i++) {
      const f = filesData[i];
      filesList.append(el('div', { style: { padding: '3px 0' } },
        `📎 ${f.filename}`,
        el('button', {
          style: { marginLeft: '8px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' },
          onClick: () => { filesData.splice(i, 1); renderFilesList(); },
        }, '✕'),
      ));
    }
  }

  const body = el('div', {},
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Клиент (обязательно):'),
    clientSearchRow, clientHint, clientMatches, clientSelected,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '12px', display: 'block' } }, 'Название заявки:'),
    titleI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Описание изделия:'),
    descI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Срок клиента (опционально):'),
    dlI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Файлы (до 10 шт., до 10 МБ каждый — фото/чертежи/ТЗ):'),
    filesInput, filesList,
  );

  openModal('Новая заявка на просчёт', body, {
    primaryLabel: 'Создать',
    size: 'lg',
    onSubmit: async () => {
      if (!titleI.value.trim()) { toast('Укажите название', 'error'); return false; }
      if (!chosen.contact_id && !chosen.company_id) { toast('Выберите клиента', 'error'); return false; }
      try {
        // Создаём заявку БЕЗ файлов — маленький payload.
        const req = await api.prCreate({
          title: titleI.value.trim(),
          description: descI.value.trim() || null,
          deadline: dlI.value ? new Date(dlI.value).toISOString() : null,
          contact_id: chosen.contact_id,
          company_id: chosen.company_id,
          files: [],
        });
        // Затем грузим файлы по одному — устойчивее к большому размеру.
        let uploaded = 0;
        for (const f of filesData) {
          try { await api.prUploadFile(req.id, f); uploaded++; }
          catch (e) { toast(`Файл ${f.filename}: ${e.message}`, 'error'); }
        }
        toast(`Заявка создана${uploaded ? ` (файлов: ${uploaded})` : ''}. Не забудь отправить на просчёт.`, 'success');
        if (onDone) await onDone();
        setTimeout(() => openViewModal(req.id, onDone), 300);
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: быстрое создание клиента (компания или контакт)
// Вложенная — открывается из модалки создания заявки. Минимум полей.
// callback получает { contact_id | company_id, label } и подставляет в поле.
// ============================================================
function openQuickClientCreate(onCreated) {
  const typeCompany = el('input', { type: 'radio', name: 'qc_type', value: 'company', checked: true });
  const typeContact = el('input', { type: 'radio', name: 'qc_type', value: 'contact' });

  const nameI = el('input', { type: 'text', style: { width: '100%', padding: '8px' }, placeholder: 'Название организации или ФИО' });
  const phoneI = el('input', { type: 'text', style: { width: '100%', padding: '8px' }, placeholder: '+7 …' });
  const emailI = el('input', { type: 'email', style: { width: '100%', padding: '8px' }, placeholder: 'необязательно' });
  const innI = el('input', { type: 'text', style: { width: '100%', padding: '8px' }, placeholder: 'необязательно' });

  const contactExtra = el('div', { style: { display: 'none' } },
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Фамилия (опционально):'),
    el('input', { type: 'text', id: 'qc_lastname', style: { width: '100%', padding: '8px' } }),
  );
  const companyExtra = el('div', {},
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'ИНН (опционально):'), innI,
  );

  function updateVisibility() {
    const isCompany = typeCompany.checked;
    contactExtra.style.display = isCompany ? 'none' : 'block';
    companyExtra.style.display = isCompany ? 'block' : 'none';
    nameI.placeholder = isCompany ? 'Название организации (например «Парк-отель Хвоя»)' : 'Имя контакта';
  }
  typeCompany.addEventListener('change', updateVisibility);
  typeContact.addEventListener('change', updateVisibility);

  const body = el('div', {},
    el('div', { style: { display: 'flex', gap: '12px', marginBottom: '8px' } },
      el('label', { style: { fontSize: '13px' } }, typeCompany, ' 🏢 Компания (юрлицо)'),
      el('label', { style: { fontSize: '13px' } }, typeContact, ' 👤 Контакт (физлицо)'),
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Название / Имя:'), nameI,
    contactExtra,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Телефон:'), phoneI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Email (опционально):'), emailI,
    companyExtra,
  );

  openModal('+ Быстрое добавление клиента', body, {
    primaryLabel: 'Добавить',
    onSubmit: async () => {
      const name = nameI.value.trim();
      if (!name) { toast('Название/имя обязательно', 'error'); return false; }
      const phone = phoneI.value.trim() || null;
      const email = emailI.value.trim() || null;
      try {
        if (typeCompany.checked) {
          const c = await api.create('companies', { name, phone, email });
          if (innI.value.trim()) {
            // ИНН не в стандартной companies-схеме — пропустим или через отдельное поле
            // (schema companies не имеет inn, оставлю без сохранения).
          }
          toast('Компания создана', 'success');
          onCreated({ company_id: c.id, label: `🏢 ${c.name}` });
        } else {
          // Разбиваем имя на first/last если есть пробел (простая эвристика).
          const parts = name.split(/\s+/);
          const firstName = parts[0];
          const lastNameFromExtra = contactExtra.querySelector('#qc_lastname')?.value.trim();
          const lastName = lastNameFromExtra || (parts.length > 1 ? parts.slice(1).join(' ') : null);
          const c = await api.create('contacts', { first_name: firstName, last_name: lastName, phone, email });
          toast('Контакт создан', 'success');
          const fullName = `${c.first_name || firstName}${c.last_name || lastName ? ' ' + (c.last_name || lastName) : ''}`;
          onCreated({ contact_id: c.id, label: `👤 ${fullName}${c.phone ? ' · ' + c.phone : ''}` });
        }
        closeModal();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: просмотр заявки + действия
// ============================================================
async function openViewModal(id, onDone) {
  openModal('Заявка', el('div', {}, '⏳'), { primaryLabel: 'Закрыть', onSubmit: () => true, size: 'lg' });
  try {
    const { request: req, files, history } = await api.prGet(id);
    const user = getStoredUser() || {};
    const status = STATUSES.find((s) => s.key === req.status) || { key: req.status, label: req.status, color: '#6b7280' };
    const body = el('div', {});

    // Шапка.
    body.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } },
      el('div', {},
        el('div', { style: { fontWeight: '600', fontSize: '16px' } }, req.title),
        el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '2px' } }, '👤 ' + clientText(req), req.contact_phone ? ' · ' + req.contact_phone : ''),
      ),
      el('span', { style: { padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600', background: status.color + '22', color: status.color } }, status.label),
    ));

    if (req.description) {
      body.append(el('div', { style: { padding: '8px', background: '#f9fafb', borderRadius: '6px', marginBottom: '10px', fontSize: '13px', whiteSpace: 'pre-wrap' } }, req.description));
    }

    // Файлы. Разделяем на общие и калькуляцию (production_only).
    if (files.length) {
      const generalFiles = files.filter((f) => f.visibility !== 'production_only');
      const calcFiles = files.filter((f) => f.visibility === 'production_only');
      if (generalFiles.length) body.append(renderFilesBox('📎 Файлы от менеджера', generalFiles));
      if (calcFiles.length && isFullAccess(user)) {
        body.append(renderFilesBox('🧾 Калькуляция производства (менеджер НЕ видит)', calcFiles, '#fef3c7', '#fde68a'));
      }
    }
    // Кнопка загрузить калькуляцию для production (в статусе awaiting_cost/negotiating/priced/approved).
    if (isFullAccess(user) && ['awaiting_cost', 'negotiating', 'priced', 'approved', 'awaiting_payment', 'in_progress'].includes(req.status)) {
      const uploadCalcBtn = el('label', {
        style: { display: 'inline-block', padding: '4px 10px', background: '#fbbf24', color: '#78350f', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', marginBottom: '10px', fontWeight: '600' },
      }, '➕ Приложить калькуляцию (только производство)',
        el('input', {
          type: 'file', style: { display: 'none' },
          onChange: async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            if (f.size > 10 * 1024 * 1024) { toast('Файл больше 10 МБ', 'error'); return; }
            const b64 = await new Promise((r, j) => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.onerror = j; rd.readAsDataURL(f); });
            try {
              await api.prUploadFile(req.id, { filename: f.name, mime: f.type, data_base64: b64, visibility: 'production_only' });
              toast('Калькуляция загружена', 'success');
              if (onDone) await onDone();
              closeModal(); setTimeout(() => openViewModal(id, onDone), 200);
            } catch (err) { toast(err.message, 'error'); }
          },
        }),
      );
      body.append(uploadCalcBtn);
    }

    // Срок сдачи (после утверждения).
    if (req.production_deadline) {
      const daysLeft = Math.ceil((new Date(req.production_deadline) - Date.now()) / (1000 * 60 * 60 * 24));
      const overdue = daysLeft < 0;
      body.append(el('div', {
        style: {
          padding: '10px', borderRadius: '6px', marginBottom: '10px', fontSize: '13px',
          background: overdue ? '#fee2e2' : (daysLeft < 3 ? '#fef3c7' : '#dbeafe'),
          border: `1px solid ${overdue ? '#fca5a5' : (daysLeft < 3 ? '#fde68a' : '#93c5fd')}`,
        },
      },
        el('b', {}, '📅 Срок сдачи: ', fmtDate(req.production_deadline)),
        overdue
          ? el('span', { style: { color: '#dc2626' } }, ` — ⚠️ просрочено на ${Math.abs(daysLeft)} дн.`)
          : el('span', {}, ` — осталось ${daysLeft} дн.`),
      ));
    }

    // Финансы. Что видит зависит от роли.
    if (req.client_price != null) {
      const finBox = el('div', { style: { padding: '10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', marginBottom: '10px' } });
      finBox.append(el('div', { style: { fontSize: '11px', color: '#166534', fontWeight: '600' } }, '💰 Финансы'));
      finBox.append(el('div', { style: { fontSize: '16px', fontWeight: '700', marginTop: '4px' } }, `Клиенту: ${fmtMoney(Number(req.client_price), 'RUB')}`));
      if (req.reward_computed != null) {
        const rewardText = req.reward_type === 'percent'
          ? `${fmtMoney(Number(req.reward_computed), 'RUB')} (${req.reward_value}%)`
          : `${fmtMoney(Number(req.reward_computed), 'RUB')} (фикс)`;
        finBox.append(el('div', { style: { fontSize: '13px', color: '#3b82f6', marginTop: '2px', fontWeight: '600' } }, `Ваше вознаграждение: ${rewardText}`));
      }
      if (isFullAccess(user) && req.cost_price != null) {
        const margin = Number(req.client_price) - Number(req.cost_price);
        finBox.append(el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' } },
          `Себестоимость: ${fmtMoney(Number(req.cost_price), 'RUB')} · Маржа: ${fmtMoney(margin, 'RUB')} · Просчитал: ${req.priced_by_name || '—'} ${req.priced_at ? '(' + fmtDateTime(req.priced_at) + ')' : ''}`,
        ));
      }
      body.append(finBox);
    }

    // История цен.
    if (history.length) {
      const histBox = el('details', { style: { marginBottom: '10px' } },
        el('summary', { style: { cursor: 'pointer', fontSize: '12px', color: '#6b7280', fontWeight: '600' } }, `История событий (${history.length})`),
      );
      const eventLabels = { initial_price: 'Первый просчёт', manager_counter: 'Торг от менеджера', production_reprice: 'Пересчёт', rejected: 'Отклонено', cancelled: 'Отменено', approved: 'Одобрено клиентом', fulfilled: 'Выполнено', paid: 'Выплачено' };
      for (const h of history) {
        histBox.append(el('div', { style: { padding: '6px', borderTop: '1px solid #f3f4f6', fontSize: '12px' } },
          el('b', {}, eventLabels[h.event] || h.event),
          ' — ', fmtDateTime(h.at), ' · ', h.actor_name || '—',
          h.client_price ? el('div', {}, `Цена: ${fmtMoney(Number(h.client_price), 'RUB')}`) : null,
          h.note ? el('div', { style: { color: '#374151' } }, h.note) : null,
        ));
      }
      body.append(histBox);
    }

    // Действия — зависят от статуса и роли.
    const actions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e5e7eb' } });
    const isMine = req.manager_id === user.id;
    const canAsAdmin = isAdmin(user);

    // Менеджер (владелец):
    if (req.status === 'draft' && (isMine || canAsAdmin)) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: async () => {
        try { await api.prSubmit(id); toast('Отправлено на просчёт', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '📤 Отправить на просчёт'));
    }
    if (req.status === 'priced' && (isMine || canAsAdmin)) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: async () => {
        try { await api.prApprove(id); toast('Заявка согласована с клиентом', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '✅ Клиент согласился'));
      actions.append(el('button', { class: 'btn', onClick: () => openCounterModal(req, onDone) }, '🔁 Клиент просит другую цену'));
    }
    // Отмена — почти всегда (кроме терминальных).
    if (!['paid', 'cancelled', 'rejected'].includes(req.status) && (isMine || canAsAdmin)) {
      actions.append(el('button', { class: 'btn', style: { color: '#ef4444' }, onClick: async () => {
        const note = prompt('Причина отмены (можно пусто):') ?? '';
        try { await api.prCancel(id, note); toast('Отменено', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '❌ Отменить'));
    }

    // Производство:
    if ((req.status === 'awaiting_cost' || req.status === 'negotiating') && (isProd(user) || canAsAdmin)) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: () => openPriceModal(req, onDone) }, req.status === 'negotiating' ? '💰 Пересчитать' : '💰 Задать цену и вознаграждение'));
      actions.append(el('button', { class: 'btn', style: { color: '#ef4444' }, onClick: async () => {
        const note = prompt('Причина отказа (обязательно):') || '';
        if (!note) return;
        try { await api.prReject(id, note); toast('Отклонено', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '🚫 Не берём в работу'));
    }
    if (req.status === 'approved' && (isProd(user) || canAsAdmin)) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: () => openDeadlineModal(req, onDone) }, '📅 Утвердить срок сдачи'));
    }
    if (req.status === 'awaiting_payment' && (isProd(user) || canAsAdmin)) {
      actions.append(el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!confirm('Подтвердить получение оплаты? Заявка перейдёт «В работу».')) return;
          try { await api.prMarkPaid(id); toast('Оплата зафиксирована', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
        },
      }, '💵 Оплата получена'));
    }
    if (req.status === 'in_progress' && (isProd(user) || canAsAdmin)) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: async () => {
        try { await api.prFulfill(id); toast('Отмечено выполненным', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '📦 Готово'));
    }
    // Админ: выплата.
    if (req.status === 'fulfilled' && canAsAdmin) {
      actions.append(el('button', { class: 'btn btn-primary', onClick: async () => {
        if (!confirm(`Подтвердить выплату менеджеру ${fmtMoney(Number(req.reward_computed || 0), 'RUB')}?`)) return;
        try { await api.prPay(id); toast('Выплата зафиксирована', 'success'); if (onDone) await onDone(); closeModal(); } catch (e) { toast(e.message, 'error'); }
      } }, '💵 Выплатить менеджеру'));
    }

    body.append(actions);

    // Чат в самом низу карточки.
    renderChatSection(body, id);

    // Заменяем содержимое модалки.
    const modalBody = document.querySelector('.modal-backdrop:last-child .modal-body');
    if (modalBody) { clear(modalBody); modalBody.append(body); }
  } catch (e) { toast(e.message, 'error'); }
}

function closeModal() {
  const b = document.querySelectorAll('.modal-backdrop');
  if (b.length) b[b.length - 1].remove();
}

function renderFilesBox(title, files, bg = '#f9fafb', border = '#e5e7eb') {
  const box = el('div', { style: { padding: '8px', background: bg, border: `1px solid ${border}`, borderRadius: '6px', marginBottom: '10px' } },
    el('div', { style: { fontSize: '11px', fontWeight: '600', color: '#374151', marginBottom: '4px' } }, title),
  );
  for (const f of files) {
    box.append(el('div', { style: { padding: '3px 0' } },
      el('a', {
        href: '#',
        onClick: async (e) => {
          e.preventDefault();
          try {
            const res = await fetch(`/api/production-requests/files/${f.id}`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('crm_token') } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = f.filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
          } catch (err) { toast(err.message, 'error'); }
        },
        style: { color: '#3b82f6', textDecoration: 'underline', fontSize: '13px' },
      }, `📎 ${f.filename}`),
      el('span', { style: { color: '#9ca3af', fontSize: '11px', marginLeft: '8px' } }, `(${(f.size_bytes / 1024).toFixed(0)} КБ)`),
    ));
  }
  return box;
}

// ============================================================
// МОДАЛКА: утверждение срока сдачи (approved → awaiting_payment)
// ============================================================
function openDeadlineModal(req, onDone) {
  const dateI = el('input', { type: 'date', style: { padding: '8px' }, min: new Date().toISOString().slice(0, 10) });
  const noteI = el('textarea', { rows: 2, style: { width: '100%', padding: '8px' }, placeholder: 'Комментарий (опционально)' });
  const body = el('div', {},
    el('div', { style: { padding: '8px', background: '#eff6ff', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' } },
      'После утверждения срока заявка появится в производственном календаре и перейдёт в статус «⌛ Ждёт оплаты».',
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Планируемая дата сдачи:'),
    dateI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Комментарий:'),
    noteI,
  );
  openModal('Утвердить срок сдачи', body, {
    primaryLabel: 'Утвердить',
    onSubmit: async () => {
      if (!dateI.value) { toast('Укажите дату', 'error'); return false; }
      try {
        await api.prSetDeadline(req.id, {
          production_deadline: new Date(dateI.value + 'T18:00:00').toISOString(),
          note: noteI.value.trim() || null,
        });
        toast('Срок утверждён. Заявка в календаре, ждёт оплаты.', 'success');
        if (onDone) await onDone();
        closeModal(); closeModal();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// ЧАТ: рендер и отправка сообщений внутри карточки заявки.
// ============================================================
async function renderChatSection(container, requestId) {
  const list = el('div', { style: { maxHeight: '260px', overflowY: 'auto', padding: '6px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px' } });
  const input = el('textarea', { rows: 2, style: { width: '100%', padding: '6px', marginTop: '6px' }, placeholder: 'Написать сообщение…' });
  const sendBtn = el('button', { class: 'btn btn-primary', style: { marginTop: '4px' } }, 'Отправить');

  container.append(
    el('div', { style: { fontSize: '12px', fontWeight: '600', color: '#374151', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e5e7eb' } }, '💬 Обсуждение'),
    list, input, sendBtn,
  );

  async function reload() {
    list.textContent = '⏳';
    try {
      const r = await api.prMessages(requestId);
      const msgs = r.messages || [];
      list.textContent = '';
      if (!msgs.length) list.append(el('div', { style: { color: '#9ca3af', padding: '6px' } }, 'Пока нет сообщений'));
      for (const m of msgs) {
        const isSys = m.kind === 'system';
        list.append(el('div', {
          style: {
            padding: '4px 8px', margin: '3px 0', borderRadius: '4px',
            background: isSys ? '#eff6ff' : '#fff',
            fontStyle: isSys ? 'italic' : 'normal',
            color: isSys ? '#1e40af' : '#111827',
            fontSize: isSys ? '12px' : '13px',
          },
        },
          el('div', { style: { fontSize: '11px', color: '#6b7280', marginBottom: '2px' } },
            isSys ? '⚙ система' : `${m.user_name || '?'} · ${fmtDateTime(m.created_at)}`,
          ),
          el('div', { style: { whiteSpace: 'pre-wrap' } }, m.text),
        ));
      }
      list.scrollTop = list.scrollHeight;
    } catch (e) { list.textContent = 'Ошибка: ' + e.message; }
  }

  sendBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await api.prSendMessage(requestId, text);
      input.value = '';
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  });

  await reload();
}

// ============================================================
// СТРАНИЦА: производственный календарь
// ============================================================
export async function renderProductionCalendar(main) {
  main.append(
    el('div', { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, '🗓 Производственный календарь'),
        el('div', { class: 'page-subtitle' }, 'Утверждённые сроки сдачи заявок производством. Сортировка по дате.'),
      ),
    ),
  );
  const listBox = el('div', {});
  main.append(listBox);
  try {
    const r = await api.prCalendar();
    if (!r.entries?.length) {
      listBox.append(el('div', { style: { padding: '32px', textAlign: 'center', color: '#9ca3af' } }, 'Ни у одной заявки ещё нет утверждённого срока сдачи.'));
      return;
    }
    // Группируем по месяцам.
    const byMonth = {};
    for (const e of r.entries) {
      const d = new Date(e.production_deadline);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      (byMonth[key] = byMonth[key] || []).push(e);
    }
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    for (const [monthKey, items] of Object.entries(byMonth)) {
      const [y, m] = monthKey.split('-');
      const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      listBox.append(el('div', { style: { fontWeight: '700', fontSize: '16px', marginTop: '16px', marginBottom: '6px', color: '#374151' } }, monthName));
      for (const e of items) {
        const dl = e.production_deadline.slice(0, 10);
        const days = Math.ceil((new Date(e.production_deadline) - now) / (1000 * 60 * 60 * 24));
        const status = STATUSES.find((s) => s.key === e.status) || { key: e.status, label: e.status, color: '#6b7280' };
        const overdue = days < 0;
        const soon = days >= 0 && days <= 3;
        const bgColor = overdue ? '#fee2e2' : soon ? '#fef3c7' : '#fff';
        const bord = overdue ? '#fca5a5' : soon ? '#fde68a' : '#e5e7eb';
        listBox.append(el('div', {
          style: {
            padding: '10px', background: bgColor, border: `1px solid ${bord}`, borderRadius: '6px',
            marginBottom: '6px', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap',
          },
          onClick: () => openViewModal(e.id, () => renderProductionCalendar(listBox.parentElement)),
        },
          el('div', {},
            el('div', { style: { fontWeight: '600', fontSize: '14px' } }, `📅 ${dl} — ${e.title}`),
            el('div', { style: { fontSize: '12px', color: '#374151', marginTop: '2px' } },
              '👤 ' + clientText(e), ' · ',
              el('span', { style: { color: status.color, fontWeight: '600' } }, status.label),
              e.manager_name ? ` · менеджер: ${e.manager_name}` : '',
            ),
          ),
          el('div', { style: { textAlign: 'right', fontSize: '13px' } },
            overdue
              ? el('span', { style: { color: '#dc2626', fontWeight: '700' } }, `⚠️ Просрочено ${Math.abs(days)} дн.`)
              : (days === 0 ? el('span', { style: { color: '#f59e0b', fontWeight: '700' } }, '🔥 Сегодня')
                : el('span', { style: { color: soon ? '#f59e0b' : '#059669', fontWeight: '600' } }, `Осталось ${days} дн.`)),
            e.client_price ? el('div', { style: { color: '#059669', fontWeight: '600', fontSize: '12px' } }, fmtMoney(Number(e.client_price), 'RUB')) : null,
          ),
        ));
      }
    }
  } catch (e) {
    listBox.append(el('div', { style: { color: '#ef4444' } }, 'Ошибка: ' + e.message));
  }
}

// ============================================================
// МОДАЛКА: просчёт (производство)
// ============================================================
function openPriceModal(req, onDone) {
  const costI = el('input', { type: 'number', step: '0.01', min: '0', style: { width: '100%', padding: '8px' }, value: req.cost_price || '' });
  const priceI = el('input', { type: 'number', step: '0.01', min: '0', style: { width: '100%', padding: '8px' }, value: req.client_price || '' });
  const rewardTypeSel = el('select', { style: { padding: '8px' } },
    el('option', { value: 'percent', selected: req.reward_type !== 'fixed' }, '% от цены'),
    el('option', { value: 'fixed', selected: req.reward_type === 'fixed' }, 'Фикс сумма ₽'),
  );
  const rewardValI = el('input', { type: 'number', step: '0.01', min: '0', style: { width: '100%', padding: '8px' }, value: req.reward_value || 10 });
  const noteI = el('textarea', { rows: 2, style: { width: '100%', padding: '8px' }, placeholder: 'Комментарий (для истории)' });
  const preview = el('div', { style: { padding: '8px', background: '#f0f9ff', borderRadius: '4px', marginTop: '6px', fontSize: '13px' } });

  function updatePreview() {
    const price = Number(priceI.value) || 0;
    const cost = Number(costI.value) || 0;
    const rv = Number(rewardValI.value) || 0;
    const rt = rewardTypeSel.value;
    const reward = rt === 'percent' ? price * rv / 100 : rv;
    const margin = price - cost - reward;
    preview.textContent = `Клиенту: ${fmtMoney(price, 'RUB')} · Себест: ${fmtMoney(cost, 'RUB')} · Менеджеру: ${fmtMoney(reward, 'RUB')} · Наша маржа: ${fmtMoney(margin, 'RUB')}`;
  }
  [costI, priceI, rewardTypeSel, rewardValI].forEach((i) => i.addEventListener('input', updatePreview));
  [costI, priceI, rewardTypeSel, rewardValI].forEach((i) => i.addEventListener('change', updatePreview));
  updatePreview();

  const body = el('div', {},
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Себестоимость (материалы + работа + накладные) ₽:'), costI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Конечная цена клиенту ₽ (менеджер увидит только её):'), priceI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Вознаграждение менеджера:'),
    el('div', { style: { display: 'flex', gap: '6px' } }, rewardTypeSel, rewardValI),
    preview,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Комментарий (опционально):'), noteI,
  );

  openModal(req.status === 'negotiating' ? 'Пересчёт (торг)' : 'Просчёт заявки', body, {
    primaryLabel: 'Сохранить просчёт',
    onSubmit: async () => {
      const cost = Number(costI.value);
      const price = Number(priceI.value);
      const rewardVal = Number(rewardValI.value);
      if (!(price > 0) || !(cost >= 0)) { toast('Введите положительные суммы', 'error'); return false; }
      if (!(rewardVal >= 0)) { toast('Введите вознаграждение', 'error'); return false; }
      try {
        await api.prPrice(req.id, {
          cost_price: cost, client_price: price,
          reward_type: rewardTypeSel.value, reward_value: rewardVal,
          note: noteI.value.trim() || null,
        });
        toast('Просчёт сохранён. Менеджер увидит цену и своё вознаграждение.', 'success');
        if (onDone) await onDone();
        closeModal(); // закрыть просчёт
        closeModal(); // закрыть карточку заявки (потом рекомендую снова открыть)
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: торг (менеджер)
// ============================================================
function openCounterModal(req, onDone) {
  const priceI = el('input', { type: 'number', step: '0.01', min: '0', style: { width: '100%', padding: '8px' }, value: req.client_price || '' });
  const noteI = el('textarea', { rows: 3, style: { width: '100%', padding: '8px' }, placeholder: 'Что говорит клиент, почему просит другую цену' });
  const body = el('div', {},
    el('div', { style: { padding: '8px', background: '#fef3c7', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' } },
      `Текущая цена клиенту: ${fmtMoney(Number(req.client_price), 'RUB')}. Впишите ту, которую хочет клиент — производство пересчитает и вернёт новую цену/вознаграждение.`,
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Желаемая цена клиента ₽:'), priceI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Комментарий (обязательно):'), noteI,
  );
  openModal('Клиент просит другую цену', body, {
    primaryLabel: 'Отправить производству',
    onSubmit: async () => {
      const price = Number(priceI.value);
      const note = noteI.value.trim();
      if (!(price > 0)) { toast('Укажите новую цену', 'error'); return false; }
      if (!note) { toast('Укажите комментарий', 'error'); return false; }
      try {
        await api.prCounter(req.id, { requested_price: price, note });
        toast('Отправлено производству на пересчёт', 'success');
        if (onDone) await onDone();
        closeModal(); closeModal();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}
