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
// Вознаграждение менеджера видит только директор/админ (foreman — нет).
const canSeeReward = (u) => u.role === 'admin' || u.role === 'rop' || u.role === 'director_prod';

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
    // Кратка-подсказка вверху раздела — раскрывается по клику.
    renderInstructionHint(user),
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

// В канбан-карточке заявки показываем оценку менеджера, если производство ещё не распределило.
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
    // Вознаграждение — видят только менеджер (owner), директор/админ.
    // Foreman не видит — reward_computed уже вырезан на бэке.
    if (req.reward_computed != null) {
      card.append(el('div', { style: { fontSize: '11px', color: '#3b82f6' } },
        `Ваше: ${fmtMoney(Number(req.reward_computed), 'RUB')}`,
      ));
    }
    // Cost видит только производство/admin. Маржа считается по-разному:
    // - для директора: маржа = client_price - cost - reward (истинная);
    // - для foreman: reward скрыт, показываем «наценка = price - cost».
    if (isFullAccess(user) && req.cost_price != null) {
      const cost = Number(req.cost_price);
      if (canSeeReward(user)) {
        const reward = Number(req.reward_computed || 0);
        const margin = price - cost - reward;
        card.append(el('div', { style: { fontSize: '11px', color: '#9ca3af' } },
          `Себест: ${fmtMoney(cost, 'RUB')} · маржа ${fmtMoney(margin, 'RUB')}`,
        ));
      } else {
        const markup = price - cost;
        card.append(el('div', { style: { fontSize: '11px', color: '#9ca3af' } },
          `Себест: ${fmtMoney(cost, 'RUB')} · наценка ${fmtMoney(markup, 'RUB')}`,
        ));
      }
    }
  }
  const foot = [];
  if (req.manager_name) foot.push('👤 ' + req.manager_name);
  if (req.files_count) foot.push(`📎 ${req.files_count}`);
  if (req.deadline) foot.push('⏰ ' + fmtDate(req.deadline));
  if (req.estimated_work_days && !req.work_start_date) foot.push(`~${req.estimated_work_days} дн.`);
  if (req.work_start_date && req.work_end_date) {
    foot.push(`🛠 ${fmtDate(req.work_start_date)}–${fmtDate(req.work_end_date)}`);
  }
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
      if (filesData.length >= 20) { toast('Максимум 20 файлов на заявку', 'error'); break; }
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
    el('div', {
      style: { padding: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', marginBottom: '10px', fontSize: '12px', color: '#1e40af' },
    },
      '💡 ',
      el('b', {}, 'Совет:'),
      ' чем точнее опишешь изделие и лучше приложишь фото/чертежи — тем быстрее и точнее просчёт. Не забудь ',
      el('b', {}, '«Отправить на просчёт»'),
      ' после создания, иначе заявка останется черновиком у тебя.',
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Клиент (обязательно):'),
    clientSearchRow, clientHint, clientMatches, clientSelected,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '12px', display: 'block' } }, 'Название заявки:'),
    titleI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Описание изделия:'),
    descI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Срок клиента (опционально):'),
    dlI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Примерный срок изготовления, дней (по вашей оценке):'),
    el('input', { type: 'number', id: 'estimated_days_input', min: '1', max: '365', style: { padding: '8px', width: '120px' }, placeholder: 'напр. 3' }),
    el('div', { style: { fontSize: '11px', color: '#6b7280', marginTop: '2px' } },
      'Ориентир для производства. Финальный срок утвердит начальник цеха.',
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Файлы (до 20 шт., до 10 МБ каждый — фото/чертежи/ТЗ):'),
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
        const estimatedDays = Number(document.getElementById('estimated_days_input')?.value) || null;
        const req = await api.prCreate({
          title: titleI.value.trim(),
          description: descI.value.trim() || null,
          deadline: dlI.value ? new Date(dlI.value).toISOString() : null,
          contact_id: chosen.contact_id,
          company_id: chosen.company_id,
          estimated_work_days: estimatedDays,
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

    // Срок сдачи + период работы (после утверждения).
    if (req.production_deadline) {
      const daysLeft = Math.ceil((new Date(req.production_deadline) - Date.now()) / (1000 * 60 * 60 * 24));
      const overdue = daysLeft < 0;
      const box = el('div', {
        style: {
          padding: '10px', borderRadius: '6px', marginBottom: '10px', fontSize: '13px',
          background: overdue ? '#fee2e2' : (daysLeft < 3 ? '#fef3c7' : '#dbeafe'),
          border: `1px solid ${overdue ? '#fca5a5' : (daysLeft < 3 ? '#fde68a' : '#93c5fd')}`,
        },
      },
        el('div', {},
          el('b', {}, '📅 Сдача клиенту: ', fmtDate(req.production_deadline)),
          overdue
            ? el('span', { style: { color: '#dc2626' } }, ` — ⚠️ просрочено на ${Math.abs(daysLeft)} дн.`)
            : el('span', {}, ` — осталось ${daysLeft} дн.`),
        ),
      );
      if (req.work_start_date && req.work_end_date) {
        const days = Math.ceil((new Date(req.work_end_date) - new Date(req.work_start_date)) / (1000 * 60 * 60 * 24)) + 1;
        box.append(el('div', { style: { marginTop: '4px', fontSize: '12px', color: '#374151' } },
          `🛠 Работа производства: ${fmtDate(req.work_start_date)} — ${fmtDate(req.work_end_date)} (${days} дн.)`,
        ));
      }
      // Кнопка «изменить сроки» для производства/admin, если в awaiting_payment/in_progress.
      if ((isProd(user) || isAdmin(user)) && ['awaiting_payment', 'in_progress'].includes(req.status)) {
        box.append(el('div', { style: { marginTop: '6px' } },
          el('a', { href: '#', style: { fontSize: '12px', color: '#3b82f6' }, onClick: (e) => { e.preventDefault(); openDeadlineModal(req, onDone); } }, '✏️ Изменить сроки'),
        ));
      }
      body.append(box);
    }

    // Финансы. Что видит зависит от роли.
    if (req.client_price != null) {
      const finBox = el('div', { style: { padding: '10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', marginBottom: '10px' } });
      finBox.append(el('div', { style: { fontSize: '11px', color: '#166534', fontWeight: '600' } }, '💰 Финансы'));
      finBox.append(el('div', { style: { fontSize: '16px', fontWeight: '700', marginTop: '4px' } }, `Клиенту: ${fmtMoney(Number(req.client_price), 'RUB')}`));
      // Вознаграждение — видят: менеджер-владелец (для мотивации), директор, admin.
      // Foreman не видит; reward_computed уже вырезан на бэке.
      if (req.reward_computed != null) {
        const rewardText = req.reward_type === 'percent'
          ? `${fmtMoney(Number(req.reward_computed), 'RUB')} (${req.reward_value}%)`
          : `${fmtMoney(Number(req.reward_computed), 'RUB')} (фикс)`;
        finBox.append(el('div', { style: { fontSize: '13px', color: '#3b82f6', marginTop: '2px', fontWeight: '600' } }, `Ваше вознаграждение: ${rewardText}`));
      } else if (canSeeReward(user)) {
        // Директор/admin видят, что вознаграждение ЕЩЁ не установлено — с кнопкой.
        finBox.append(el('div', { style: { fontSize: '12px', color: '#dc2626', marginTop: '4px', fontWeight: '600' } },
          '⚠️ Вознаграждение менеджера ещё не установлено',
        ));
        finBox.append(el('div', { style: { marginTop: '4px' } },
          el('button', { class: 'btn btn-sm btn-primary', onClick: () => openRewardModal(req, onDone) }, '💼 Установить вознаграждение'),
        ));
      }
      // Себестоимость и маржа — для полного доступа. Маржа считается с учётом reward
      // если директор, без reward — для foreman.
      if (isFullAccess(user) && req.cost_price != null) {
        const cost = Number(req.cost_price);
        const price = Number(req.client_price);
        if (canSeeReward(user)) {
          const reward = Number(req.reward_computed || 0);
          const margin = price - cost - reward;
          finBox.append(el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' } },
            `Себестоимость: ${fmtMoney(cost, 'RUB')} · Маржа: ${fmtMoney(margin, 'RUB')} · Просчитал: ${req.priced_by_name || '—'} ${req.priced_at ? '(' + fmtDateTime(req.priced_at) + ')' : ''}`,
          ));
        } else {
          // foreman видит только себестоимость и наценку (price - cost), без reward.
          const markup = price - cost;
          finBox.append(el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' } },
            `Себестоимость: ${fmtMoney(cost, 'RUB')} · Наценка: ${fmtMoney(markup, 'RUB')} · Просчитал: ${req.priced_by_name || '—'} ${req.priced_at ? '(' + fmtDateTime(req.priced_at) + ')' : ''}`,
          ));
        }
      }
      // Директор/admin могут перезадать вознаграждение отдельной кнопкой.
      if (canSeeReward(user) && req.reward_computed != null && !['paid', 'cancelled', 'rejected'].includes(req.status)) {
        finBox.append(el('div', { style: { marginTop: '4px' } },
          el('a', { href: '#', style: { fontSize: '11px', color: '#3b82f6' }, onClick: (e) => { e.preventDefault(); openRewardModal(req, onDone); } }, '✏️ Изменить вознаграждение'),
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

    // Админ: удалить навсегда (для тестовых записей). Доступно в любом статусе.
    // Скрыта в отдельном details, чтобы случайно не нажать.
    if (canAsAdmin) {
      const dangerDetails = el('details', { style: { marginTop: '12px', padding: '6px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px' } },
        el('summary', { style: { cursor: 'pointer', fontSize: '11px', color: '#991b1b', fontWeight: '600' } }, '⚠️ Опасная зона'),
        el('div', { style: { marginTop: '8px' } },
          el('div', { style: { fontSize: '12px', color: '#7f1d1d', marginBottom: '6px' } },
            'Удалить заявку и всю её историю (файлы, чат, цены) БЕЗ ВОЗМОЖНОСТИ ВОССТАНОВЛЕНИЯ. Только для тестовых/мусорных.',
          ),
          el('button', {
            class: 'btn', style: { background: '#dc2626', color: '#fff' },
            onClick: async () => {
              const phrase = prompt(`Введите слово УДАЛИТЬ (заглавными), чтобы удалить заявку #${id} «${req.title}»:`);
              if (!phrase || phrase.trim() !== 'УДАЛИТЬ') { if (phrase) toast('Не подтверждено', 'error'); return; }
              try {
                await api.prDelete(id);
                toast('Заявка удалена', 'success');
                if (onDone) await onDone();
                closeModal();
              } catch (e) { toast(e.message, 'error'); }
            },
          }, '🗑 Удалить навсегда'),
        ),
      );
      actions.append(dangerDetails);
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

// Свёрнутая подсказка по роли — читается один раз, потом сворачивается через localStorage.
function renderInstructionHint(user) {
  const storeKey = 'pr_hint_seen_' + user.role;
  let seen = false;
  try { seen = localStorage.getItem(storeKey) === '1'; } catch { /* ignore */ }
  const bodyText = isProd(user)
    ? '1) Заявки от менеджеров сортируются в канбане слева-направо. Твоя колонка — «🧮 На просчёте». 2) Открой карточку, скачай файлы менеджера, приложи свою калькуляцию (жёлтая кнопка — менеджер её НЕ видит), задай цену клиенту и вознаграждение. 3) После согласования клиентом — утверди срок сдачи (появится в календаре). 4) Когда оплата пришла — «Оплата получена», заявка в работе. 5) Изделие готово — «Готово».'
    : isAdmin(user)
      ? 'Ты видишь всё: себестоимость, цену клиенту, вознаграждение, файлы калькуляции. Твоя финальная кнопка — «💵 Выплатить менеджеру» после «Выполнено».'
      : '1) Создай заявку («+ Новая заявка») с описанием и файлами. Обязательно клиент. 2) Отправь на просчёт — придёт готовая цена + твоё вознаграждение. 3) Согласуй с клиентом. Если клиент торгуется — «Клиент просит другую цену». 4) Отслеживай в календаре срок. 5) Когда админ отметит выплату — вознаграждение твоё.';
  const box = el('details', {
    style: { padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', margin: '8px 0', fontSize: '13px' },
    open: !seen,
  });
  const summary = el('summary', { style: { cursor: 'pointer', fontWeight: '600', color: '#1e40af' } }, '📘 Как работать в этом разделе (краткая инструкция)');
  box.append(summary, el('div', { style: { marginTop: '6px', lineHeight: '1.5' } }, bodyText));
  box.addEventListener('toggle', () => {
    if (!box.open) { try { localStorage.setItem(storeKey, '1'); } catch { /* ignore */ } }
  });
  return box;
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
// Три даты: сдача клиенту + начало работ + конец работ. Плюс автоподсчёт
// длительности. Плюс валидация start ≤ end ≤ deadline.
// ============================================================
function openDeadlineModal(req, onDone) {
  const today = new Date().toISOString().slice(0, 10);
  const toDate = (s) => (s ? String(s).slice(0, 10) : '');
  const deadlineI = el('input', { type: 'date', style: { padding: '8px' }, min: today, value: toDate(req.production_deadline) });
  // Подставляем длительность из оценки менеджера (если задал), иначе пусто.
  const durationI = el('input', {
    type: 'number', min: '1', max: '365', style: { padding: '8px', width: '90px' },
    placeholder: 'дней', value: req.estimated_work_days ? String(req.estimated_work_days) : '',
  });
  const startI = el('input', { type: 'date', style: { padding: '8px' }, min: today, value: toDate(req.work_start_date) });
  const endI = el('input', { type: 'date', style: { padding: '8px' }, min: today, value: toDate(req.work_end_date) });
  const info = el('div', { style: { fontSize: '12px', color: '#374151', marginTop: '4px' } });

  // Автоподсказка длительности при вводе start/end.
  function recalcDuration() {
    if (startI.value && endI.value) {
      const days = Math.max(1, Math.ceil((new Date(endI.value) - new Date(startI.value)) / (1000 * 60 * 60 * 24)) + 1);
      durationI.value = String(days);
      updateInfo();
    }
  }
  // При вводе длительности + известной дате сдачи — автоставим start.
  function fillFromDuration() {
    const n = Number(durationI.value);
    if (!n || !deadlineI.value) return;
    const end = new Date(deadlineI.value);
    const start = new Date(end);
    start.setDate(end.getDate() - (n - 1));
    startI.value = start.toISOString().slice(0, 10);
    endI.value = end.toISOString().slice(0, 10);
    updateInfo();
  }
  function updateInfo() {
    if (deadlineI.value && startI.value && endI.value) {
      if (startI.value > endI.value) { info.textContent = '⚠️ Начало работ позже окончания'; info.style.color = '#dc2626'; return; }
      if (endI.value > deadlineI.value) { info.textContent = '⚠️ Окончание работ позже срока сдачи клиенту'; info.style.color = '#dc2626'; return; }
      const days = Math.ceil((new Date(endI.value) - new Date(startI.value)) / (1000 * 60 * 60 * 24)) + 1;
      const bufferDays = Math.floor((new Date(deadlineI.value) - new Date(endI.value)) / (1000 * 60 * 60 * 24));
      info.textContent = `Работа: ${days} дн. · Запас до сдачи: ${bufferDays} дн.`;
      info.style.color = '#059669';
    } else info.textContent = '';
  }
  deadlineI.addEventListener('change', updateInfo);
  startI.addEventListener('change', recalcDuration);
  endI.addEventListener('change', recalcDuration);
  durationI.addEventListener('change', fillFromDuration);
  setTimeout(updateInfo, 0);

  const body = el('div', {},
    el('div', { style: { padding: '8px', background: '#eff6ff', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' } },
      '💡 Три даты: ',
      el('b', {}, 'Сдача клиенту'),
      ' — когда обещаем отдать. ',
      el('b', {}, 'Работа'),
      ' — реальный период производства (например 2 дня из 30-дневного окна). Между работой и сдачей — запас на форс-мажоры/логистику. В календаре плитка показывает только период РАБОТЫ — цех видит реальную нагрузку.',
    ),
    req.estimated_work_days
      ? el('div', { style: { padding: '6px 10px', background: '#f0fdf4', borderRadius: '4px', marginBottom: '8px', fontSize: '12px', color: '#166534' } },
          `📏 Менеджер оценил работу в ${req.estimated_work_days} дн. — длительность внизу уже подставлена. Можешь изменить.`)
      : null,
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, '📅 Сдача клиенту:'),
    deadlineI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '10px', display: 'block' } }, '🛠 Период работы производства:'),
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', { style: { fontSize: '11px', color: '#6b7280' } }, 'с'),
      startI,
      el('span', { style: { fontSize: '11px', color: '#6b7280' } }, 'по'),
      endI,
      el('span', { style: { fontSize: '11px', color: '#6b7280' } }, '·'),
      el('span', { style: { fontSize: '11px', color: '#6b7280' } }, 'или задать длит.'),
      durationI,
      el('span', { style: { fontSize: '11px', color: '#6b7280' } }, 'дн.'),
    ),
    info,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '10px', display: 'block' } }, 'Комментарий:'),
    el('textarea', { rows: 2, id: 'deadline_note', style: { width: '100%', padding: '8px' }, placeholder: 'Опционально: что важно учесть, откуда запас и т.п.' }),
  );

  openModal('Утвердить сроки заявки', body, {
    primaryLabel: 'Утвердить',
    onSubmit: async () => {
      if (!deadlineI.value) { toast('Укажите срок сдачи клиенту', 'error'); return false; }
      if (!startI.value || !endI.value) { toast('Укажите период работы производства', 'error'); return false; }
      if (startI.value > endI.value) { toast('Начало работ позже окончания', 'error'); return false; }
      if (endI.value > deadlineI.value) { toast('Окончание работ позже срока сдачи', 'error'); return false; }
      try {
        await api.prSetDeadline(req.id, {
          production_deadline: deadlineI.value,
          work_start_date: startI.value,
          work_end_date: endI.value,
          note: document.getElementById('deadline_note')?.value.trim() || null,
        });
        toast('Сроки сохранены. Заявка в календаре.', 'success');
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
  const attachLabel = el('label', {
    style: { display: 'inline-block', padding: '4px 10px', background: '#e5e7eb', color: '#374151', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
  }, '📎 Прикрепить');
  const attachInput = el('input', { type: 'file', style: { display: 'none' } });
  attachLabel.append(attachInput);
  const attachedInfo = el('span', { style: { marginLeft: '8px', fontSize: '12px', color: '#6b7280' } });
  const sendBtn = el('button', { class: 'btn btn-primary', style: { marginLeft: '8px' } }, 'Отправить');

  let pendingAttachment = null; // { filename, mime, data_base64 }

  attachInput.addEventListener('change', async () => {
    const f = attachInput.files?.[0]; if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast('Файл больше 10 МБ', 'error'); attachInput.value = ''; return; }
    const b64 = await new Promise((r, j) => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.onerror = j; rd.readAsDataURL(f); });
    pendingAttachment = { filename: f.name, mime: f.type, data_base64: b64 };
    attachedInfo.textContent = `📎 ${f.name} (${(f.size / 1024).toFixed(0)} КБ) — прикреплено. `;
    // Ссылка «убрать».
    const rmBtn = el('a', { href: '#', style: { color: '#ef4444' }, onClick: (e) => {
      e.preventDefault(); pendingAttachment = null; attachInput.value = ''; attachedInfo.textContent = '';
    } }, 'убрать');
    attachedInfo.append(rmBtn);
  });

  container.append(
    el('div', { style: { fontSize: '12px', fontWeight: '600', color: '#374151', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e5e7eb' } }, '💬 Обсуждение'),
    list, input,
    el('div', { style: { marginTop: '6px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' } }, attachLabel, attachedInfo, sendBtn),
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
        const box = el('div', {
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
          m.text ? el('div', { style: { whiteSpace: 'pre-wrap' } }, m.text) : null,
        );
        // Вложение — если есть.
        if (m.attachment_id) {
          box.append(el('div', { style: { marginTop: '4px' } },
            el('a', {
              href: '#',
              style: { color: '#3b82f6', textDecoration: 'underline', fontSize: '13px' },
              onClick: async (e) => {
                e.preventDefault();
                try {
                  const res = await fetch(`/api/production-requests/files/${m.attachment_id}`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('crm_token') } });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = m.attachment_filename;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                } catch (err) { toast(err.message, 'error'); }
              },
            }, `📎 ${m.attachment_filename}`),
            el('span', { style: { color: '#9ca3af', fontSize: '11px', marginLeft: '6px' } }, `(${(Number(m.attachment_size) / 1024).toFixed(0)} КБ)`),
          ));
        }
        list.append(box);
      }
      list.scrollTop = list.scrollHeight;
    } catch (e) { list.textContent = 'Ошибка: ' + e.message; }
  }

  sendBtn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text && !pendingAttachment) { toast('Введите текст или прикрепите файл', 'error'); return; }
    try {
      await api.prSendMessage(requestId, { text, attachment: pendingAttachment });
      input.value = '';
      pendingAttachment = null; attachInput.value = ''; attachedInfo.textContent = '';
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  });

  await reload();
}

// ============================================================
// СТРАНИЦА: производственный календарь (месячная сетка)
// ============================================================
export async function renderProductionCalendar(main) {
  // Состояние: текущий месяц.
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0..11

  const header = el('div', { class: 'page-header' });
  const legend = el('details', {
    style: { padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '10px', fontSize: '12px' },
  },
    el('summary', { style: { cursor: 'pointer', fontWeight: '600', color: '#374151' } }, '📘 Как читать календарь'),
    el('div', { style: { marginTop: '6px', lineHeight: '1.5' } },
      '• Плитка — период РАБОТ производства (например 2 дня), а не всё время ожидания клиента.',
      el('br', {}),
      '• Плитка ⚑ (яркая) — день сдачи клиенту.',
      el('br', {}),
      '• Контурная плитка (пунктир) — день сдачи ВНЕ периода работ (буфер на форс-мажоры/логистику).',
      el('br', {}),
      '• Цвет по статусу: 🟠 ждёт оплаты · 🔵 в работе · 🟢 выполнено · 💵 выплачено.',
      el('br', {}),
      '• Синяя рамка = сегодня. Приглушённые ячейки — соседние месяцы.',
      el('br', {}),
      '• Жёлтая панель сверху = заявки, где сроки ещё не утверждены (клик по чипу → карточка → «Утвердить сроки»).',
    ),
  );
  const awaitBox = el('div', { style: { marginBottom: '12px' } });
  const nav = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } });
  const grid = el('div', {});
  main.append(header, legend, awaitBox, nav, grid);

  async function reload() {
    // Шапка.
    clear(header);
    header.append(el('div', {},
      el('h1', { class: 'page-title' }, '🗓 Производственный календарь'),
      el('div', { class: 'page-subtitle' }, 'Сроки сдачи заявок. Клик по заявке — карточка. Секция сверху — заявки без утверждённого срока.'),
    ));

    // Секция «Нужно распределить». Заявки, где сроки работы ЕЩЁ НЕ утверждены:
    //   approved без production_deadline, ИЛИ awaiting_payment/in_progress без work_start/end.
    // У чипа показываем оценку менеджера в днях — начальник сразу видит какое
    // окно надо забронировать в календаре.
    clear(awaitBox);
    try {
      const [ra, rap, rip] = await Promise.all([
        api.prList({ status: 'approved' }),
        api.prList({ status: 'awaiting_payment' }),
        api.prList({ status: 'in_progress' }),
      ]);
      const need = [];
      for (const list of [ra.requests || [], rap.requests || [], rip.requests || []]) {
        for (const x of list) {
          if (!x.work_start_date || !x.work_end_date) need.push(x);
        }
      }
      if (need.length) {
        const box = el('div', {
          style: { padding: '10px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px' },
        });
        box.append(el('div', { style: { fontWeight: '600', fontSize: '13px', color: '#78350f', marginBottom: '4px' } },
          `⚠️ Нужно распределить в календаре (${need.length}) — клик на заявку → «Утвердить сроки»:`,
        ));
        for (const req of need) {
          const daysHint = req.estimated_work_days ? ` · ~${req.estimated_work_days} дн.` : '';
          const chip = el('span', {
            style: { display: 'inline-block', padding: '4px 10px', margin: '2px', background: '#fff', border: '1px solid #fbbf24', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
            onClick: () => openViewModal(req.id, () => renderProductionCalendar(main)),
          },
            req.title,
            req.client_price ? el('span', { style: { color: '#6b7280', marginLeft: '4px' } }, ` — ${fmtMoney(Number(req.client_price), 'RUB')}`) : null,
            daysHint ? el('span', { style: { color: '#059669', fontWeight: '600', marginLeft: '4px' } }, daysHint) : null,
          );
          box.append(chip);
        }
        awaitBox.append(box);
      }
    } catch { /* ignore */ }

    // Навигация по месяцам.
    clear(nav);
    const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    nav.append(
      el('button', { class: 'btn', onClick: () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } reload(); } }, '◀'),
      el('div', { style: { fontSize: '18px', fontWeight: '700', color: '#374151', textTransform: 'capitalize' } }, monthName),
      el('div', {},
        el('button', { class: 'btn', style: { marginRight: '4px' }, onClick: () => { viewYear = now.getFullYear(); viewMonth = now.getMonth(); reload(); } }, 'Сегодня'),
        el('button', { class: 'btn', onClick: () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } reload(); } }, '▶'),
      ),
    );

    // Данные месяца + запас +-1 неделя.
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const from = new Date(viewYear, viewMonth, 1);
    from.setDate(1);
    from.setDate(from.getDate() - 7);
    const to = new Date(viewYear, viewMonth + 1, 0);
    to.setDate(to.getDate() + 7);

    let entries = [];
    try {
      const r = await api.prCalendar({ from: from.toISOString(), to: to.toISOString() });
      entries = r.entries || [];
    } catch (e) { grid.textContent = 'Ошибка: ' + e.message; return; }

    // Индексируем по каждому дню периода РАБОТЫ производства.
    //   Если утверждены work_start_date / work_end_date — используем их (плановая
    //   загрузка цеха: реальные 2 дня, а не 30-дневное ожидание клиента).
    //   Иначе fallback: старая логика от начала обработки до сдачи (не портит
    //   отображение для заявок, где новые поля ещё не заполнены).
    // Отдельно помечаем день production_deadline (сдача клиенту) — флажок ⚑.
    const byDate = {};
    for (const e of entries) {
      const dlKey = e.production_deadline ? e.production_deadline.slice(0, 10) : null;
      let startKey, endKey;
      if (e.work_start_date && e.work_end_date) {
        startKey = e.work_start_date.slice(0, 10);
        endKey = e.work_end_date.slice(0, 10);
      } else {
        const startISO = e.payment_received_at || e.deadline_set_at || e.approved_at || e.created_at;
        const endISO = e.fulfilled_at || e.production_deadline;
        if (!startISO || !endISO) continue;
        startKey = startISO.slice(0, 10);
        endKey = endISO.slice(0, 10);
      }
      const start = new Date(startKey);
      const end = new Date(endKey);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        (byDate[key] = byDate[key] || []).push({ ...e, _isDeadlineDay: key === dlKey });
      }
      // Если день сдачи находится ВНЕ рабочего периода — тоже покажем плитку.
      if (dlKey && (dlKey < startKey || dlKey > endKey)) {
        (byDate[dlKey] = byDate[dlKey] || []).push({ ...e, _isDeadlineDay: true, _dlOnly: true });
      }
    }

    // Строим сетку 7 колонок. Понедельник — первый день (RU).
    clear(grid);
    const dayHeaders = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const gridEl = el('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: '4px', background: '#f3f4f6', padding: '4px', borderRadius: '6px',
      },
    });
    for (const h of dayHeaders) gridEl.append(el('div', {
      style: { padding: '4px', fontWeight: '700', fontSize: '11px', color: '#6b7280', textAlign: 'center' },
    }, h));

    // Первый день месяца — какой день недели? Пн=0, Вс=6.
    const jsDow = firstDay.getDay(); // 0=Вс, 1=Пн
    const startOffset = (jsDow + 6) % 7; // Пн=0

    // Пустые ячейки до начала месяца — заполняем предыдущим месяцем.
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(viewYear, viewMonth, 1 - (startOffset - i));
      gridEl.append(renderCalendarCell(d, byDate, true, () => renderProductionCalendar(main)));
    }
    // Сам месяц.
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d = new Date(viewYear, viewMonth, day);
      gridEl.append(renderCalendarCell(d, byDate, false, () => renderProductionCalendar(main)));
    }
    // Заполняем хвост до полной недели.
    const totalCells = startOffset + lastDay.getDate();
    const tailCount = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= tailCount; i++) {
      const d = new Date(viewYear, viewMonth + 1, i);
      gridEl.append(renderCalendarCell(d, byDate, true, () => renderProductionCalendar(main)));
    }
    grid.append(gridEl);
  }

  await reload();
}

function renderCalendarCell(date, byDate, outOfMonth, onDone) {
  const now = new Date();
  const todayStr = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const key = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const items = byDate[key] || [];
  const isToday = key === todayStr;
  const isPast = key < todayStr;
  const cell = el('div', {
    style: {
      background: '#fff', minHeight: '90px', padding: '4px', borderRadius: '4px',
      opacity: outOfMonth ? 0.4 : 1,
      border: isToday ? '2px solid #3b82f6' : '1px solid transparent',
      display: 'flex', flexDirection: 'column',
    },
  });
  cell.append(el('div', {
    style: {
      fontSize: '11px', fontWeight: isToday ? '700' : '600',
      color: isToday ? '#3b82f6' : (isPast ? '#9ca3af' : '#374151'),
      marginBottom: '2px',
    },
  }, String(date.getDate())));
  for (const req of items) {
    const status = STATUSES.find((s) => s.key === req.status) || { color: '#6b7280' };
    const isDeadline = req._isDeadlineDay;
    const dlOnly = req._dlOnly;
    // День сдачи — плитка ярче и с флажком.
    // Обычный рабочий день — легкая заливка.
    // «Только сдача» (день deadline ВНЕ работы, буфер) — контурная плитка.
    const bg = dlOnly ? '#fff' : (isDeadline ? status.color : status.color + '33');
    const color = dlOnly ? status.color : (isDeadline ? '#fff' : status.color);
    const border = dlOnly ? `1px dashed ${status.color}` : 'none';
    cell.append(el('div', {
      title: `${req.title} · ${clientText(req)}${req.client_price ? ' · ' + fmtMoney(Number(req.client_price), 'RUB') : ''}${isDeadline ? ' · СДАЧА' : ' · РАБОТА'}`,
      style: {
        fontSize: '10px', padding: '2px 4px', marginBottom: '2px',
        background: bg, color, border,
        borderLeft: `3px solid ${status.color}`, borderRadius: '2px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        cursor: 'pointer', lineHeight: '1.2', fontWeight: isDeadline ? '700' : '400',
      },
      onClick: (e) => { e.stopPropagation(); openViewModal(req.id, onDone); },
    }, isDeadline ? `⚑ ${req.title}` : req.title));
  }
  return cell;
}

// ============================================================
// МОДАЛКА: просчёт (производство)
// Для foreman: только cost + client_price. Вознаграждение вводит директор
// (отдельной кнопкой). Для director/admin: и cost/price, и вознаграждение
// одним действием.
// ============================================================
function openPriceModal(req, onDone) {
  const user = getStoredUser() || {};
  const showReward = canSeeReward(user);
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
    if (showReward) {
      const rv = Number(rewardValI.value) || 0;
      const rt = rewardTypeSel.value;
      const reward = rt === 'percent' ? price * rv / 100 : rv;
      const margin = price - cost - reward;
      preview.textContent = `Клиенту: ${fmtMoney(price, 'RUB')} · Себест: ${fmtMoney(cost, 'RUB')} · Менеджеру: ${fmtMoney(reward, 'RUB')} · Наша маржа: ${fmtMoney(margin, 'RUB')}`;
    } else {
      // foreman: без вознаграждения, показываем наценку.
      const markup = price - cost;
      preview.textContent = `Клиенту: ${fmtMoney(price, 'RUB')} · Себест: ${fmtMoney(cost, 'RUB')} · Наценка: ${fmtMoney(markup, 'RUB')}`;
    }
  }
  const watched = showReward ? [costI, priceI, rewardTypeSel, rewardValI] : [costI, priceI];
  watched.forEach((i) => { i.addEventListener('input', updatePreview); i.addEventListener('change', updatePreview); });
  updatePreview();

  const body = el('div', {},
    el('div', {
      style: { padding: '8px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '4px', marginBottom: '10px', fontSize: '12px', color: '#78350f' },
    },
      '💡 ',
      el('b', {}, 'Важно:'),
      ' менеджер увидит ТОЛЬКО «Цена клиенту»',
      showReward ? ' и своё вознаграждение' : '',
      '. Себестоимость и внутренние расчёты — только для производства и админа. ',
      el('b', {}, 'Не забудь приложить калькуляцию'),
      ' через жёлтую кнопку «➕ Приложить калькуляцию» на карточке заявки — этот файл менеджер тоже не увидит.',
      !showReward ? el('div', { style: { marginTop: '6px' } },
        '👤 Вознаграждение менеджера в этой форме не задаётся — его определяет ',
        el('b', {}, 'директор производства'),
        ' отдельно, после того как вы сохранили просчёт.',
      ) : null,
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Себестоимость (материалы + работа + накладные) ₽:'), costI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Конечная цена клиенту ₽ (менеджер увидит только её):'), priceI,
    showReward ? el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Вознаграждение менеджера:') : null,
    showReward ? el('div', { style: { display: 'flex', gap: '6px' } }, rewardTypeSel, rewardValI) : null,
    preview,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Комментарий (опционально):'), noteI,
  );

  openModal(req.status === 'negotiating' ? 'Пересчёт (торг)' : 'Просчёт заявки', body, {
    primaryLabel: 'Сохранить просчёт',
    onSubmit: async () => {
      const cost = Number(costI.value);
      const price = Number(priceI.value);
      if (!(price > 0) || !(cost >= 0)) { toast('Введите положительные суммы', 'error'); return false; }
      const payload = { cost_price: cost, client_price: price, note: noteI.value.trim() || null };
      if (showReward) {
        const rewardVal = Number(rewardValI.value);
        if (!(rewardVal >= 0)) { toast('Введите вознаграждение', 'error'); return false; }
        payload.reward_type = rewardTypeSel.value;
        payload.reward_value = rewardVal;
      }
      try {
        await api.prPrice(req.id, payload);
        toast('Просчёт сохранён', 'success');
        if (onDone) await onDone();
        closeModal(); closeModal();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: установить/изменить вознаграждение менеджера (только директор/админ).
// ============================================================
function openRewardModal(req, onDone) {
  const rewardTypeSel = el('select', { style: { padding: '8px' } },
    el('option', { value: 'percent', selected: req.reward_type !== 'fixed' }, '% от цены'),
    el('option', { value: 'fixed', selected: req.reward_type === 'fixed' }, 'Фикс ₽'),
  );
  const rewardValI = el('input', { type: 'number', step: '0.01', min: '0', style: { width: '120px', padding: '8px' }, value: req.reward_value || 10 });
  const noteI = el('input', { type: 'text', style: { width: '100%', padding: '8px' }, placeholder: 'Комментарий (опц.)' });
  const preview = el('div', { style: { padding: '8px', background: '#f0f9ff', borderRadius: '4px', marginTop: '6px', fontSize: '13px' } });
  function upd() {
    const price = Number(req.client_price) || 0;
    const rv = Number(rewardValI.value) || 0;
    const rt = rewardTypeSel.value;
    const r = rt === 'percent' ? price * rv / 100 : rv;
    preview.textContent = `Клиенту: ${fmtMoney(price, 'RUB')} → менеджеру: ${fmtMoney(r, 'RUB')}`;
  }
  rewardTypeSel.addEventListener('change', upd);
  rewardValI.addEventListener('input', upd);
  setTimeout(upd, 0);
  const body = el('div', {},
    el('div', { style: { fontSize: '12px', color: '#6b7280', marginBottom: '8px' } }, 'Устанавливается директором производства/админом. Foreman не видит.'),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Вознаграждение:'),
    el('div', { style: { display: 'flex', gap: '6px' } }, rewardTypeSel, rewardValI),
    preview,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Комментарий:'),
    noteI,
  );
  openModal('Вознаграждение менеджера', body, {
    primaryLabel: 'Сохранить',
    onSubmit: async () => {
      const rv = Number(rewardValI.value);
      if (!(rv >= 0)) { toast('Введите вознаграждение', 'error'); return false; }
      try {
        await api.prSetReward(req.id, { reward_type: rewardTypeSel.value, reward_value: rv, note: noteI.value.trim() || null });
        toast('Вознаграждение установлено', 'success');
        if (onDone) await onDone();
        closeModal(); closeModal();
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
