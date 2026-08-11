// Модуль «Обзвон» — отдельно от views.js (тот уже 6300 строк).
// Экспорт: renderCalling(main). Три вкладки: Мои задачи / Кампании / Аналитика.
// Видимость раздела: admin/rop всегда; менеджер — только с флагом is_active_caller.

import { api, getStoredUser } from './api.js';
import { clear, el, fmtDateTime, toast, openModal, emptyState } from './ui.js';

const OUTCOME_LABELS = {
  no_answer: '📵 Не ответил',
  not_interested: '❌ Отказ',
  callback: '⏰ Перезвонить',
  qualified: '✅ Заинтересован',
  meeting_scheduled: '📅 Встреча',
  converted: '💰 Готов покупать',
  dead: '⚰️ Мёртвый',
};
const OUTCOME_COLORS = {
  no_answer: '#94a3b8',
  not_interested: '#ef4444',
  callback: '#3b82f6',
  qualified: '#22c55e',
  meeting_scheduled: '#8b5cf6',
  converted: '#059669',
  dead: '#64748b',
};
const CAMPAIGN_TYPE_LABELS = {
  production_order: '🏭 На производство',
  product_sales: '📦 Продажа изделий',
};
const CAMPAIGN_STATUS_LABELS = {
  draft: 'Черновик',
  active: 'Активна',
  paused: 'Пауза',
  closed: 'Закрыта',
};

// ============================================================
// Главный рендер: шапка + переключатель вкладок.
// ============================================================
export async function renderCalling(main) {
  const user = getStoredUser() || {};
  const isAdmin = user.role === 'admin' || user.role === 'rop';

  main.append(
    el('div', { class: 'page-header' },
      el('div', {},
        el('h1', { class: 'page-title' }, '📞 Обзвон'),
        el('div', { class: 'page-subtitle' },
          isAdmin
            ? 'Загружайте базы, распределяйте на менеджеров, следите за результатами.'
            : 'Работайте с назначенными вам лидами. После каждого звонка — фиксируйте результат.',
        ),
      ),
    ),
  );

  // Свои задачи есть у всех активных обзвонщиков (в т.ч. admin/rop).
  const tabs = [];
  tabs.push({ key: 'my', label: '📋 Мои задачи', render: renderMyTasks });
  if (isAdmin) {
    tabs.push({ key: 'campaigns', label: '📢 Кампании', render: renderCampaigns });
    tabs.push({ key: 'analytics', label: '📊 Аналитика', render: renderAnalytics });
    tabs.push({ key: 'managers', label: '👥 Обзвонщики', render: renderCallers });
  }

  const tabBar = el('div', { style: { display: 'flex', gap: '8px', margin: '16px 0', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' } });
  const tabContent = el('div', {});
  main.append(tabBar, tabContent);

  let active = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || tabs[0].key;
  if (!tabs.find((t) => t.key === active)) active = tabs[0].key;

  function drawTabs() {
    clear(tabBar);
    for (const t of tabs) {
      const isActive = t.key === active;
      tabBar.append(el('button', {
        class: 'btn',
        style: {
          padding: '8px 16px', border: 'none', background: 'transparent',
          borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
          color: isActive ? '#3b82f6' : '#374151',
          fontWeight: isActive ? '600' : '400',
          cursor: 'pointer',
        },
        onClick: () => { active = t.key; drawTabs(); renderActive(); },
      }, t.label));
    }
  }
  async function renderActive() {
    clear(tabContent);
    tabContent.append(el('div', {}, '⏳ Загрузка…'));
    try {
      const tab = tabs.find((t) => t.key === active);
      clear(tabContent);
      await tab.render(tabContent);
    } catch (e) {
      clear(tabContent);
      tabContent.append(el('div', { class: 'error' }, `Ошибка: ${e.message}`));
    }
  }
  drawTabs();
  await renderActive();
}

// ============================================================
// ВКЛАДКА: МОИ ЗАДАЧИ (менеджер)
// ============================================================
async function renderMyTasks(area) {
  const scopeChip = (key, label) => el('button', {
    class: 'btn', dataset: { k: key }, style: {
      padding: '6px 12px', marginRight: '6px', borderRadius: '20px',
      border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
    },
  }, label);

  let currentScope = 'today';
  let currentCampaign = null;

  const kpiBar = el('div', { style: { padding: '12px', background: '#f0f9ff', borderRadius: '8px', marginBottom: '12px', fontSize: '14px' } });
  const scopeBar = el('div', { style: { marginBottom: '12px' } },
    scopeChip('today', 'На сегодня'),
    scopeChip('callbacks', 'Callbacks'),
    scopeChip('all', 'Все мои'),
  );
  const campFilter = el('select', { style: { padding: '6px', marginLeft: '8px' } },
    el('option', { value: '' }, 'Все кампании'),
  );
  scopeBar.append(campFilter);
  const list = el('div', {});
  area.append(kpiBar, scopeBar, list);

  // Загрузка кампаний в фильтр.
  try {
    const camps = await api.callingCampaigns();
    for (const c of camps.campaigns || []) {
      campFilter.append(el('option', { value: c.id }, `${CAMPAIGN_TYPE_LABELS[c.type] || c.type} · ${c.name}`));
    }
  } catch { /* ignore */ }

  async function reload() {
    // Подсветка активного scope-чипа.
    scopeBar.querySelectorAll('button').forEach((b) => {
      b.style.background = b.dataset.k === currentScope ? '#3b82f6' : '#fff';
      b.style.color = b.dataset.k === currentScope ? '#fff' : '#374151';
    });
    clear(list);
    list.append(el('div', {}, '⏳ Загрузка задач…'));
    const params = { scope: currentScope };
    if (currentCampaign) params.campaign_id = currentCampaign;
    const r = await api.callingMyTasks(params);
    clear(list);
    // KPI.
    clear(kpiBar);
    const kpi = r.kpi || {};
    kpiBar.append(
      el('b', {}, `Сегодня: ${kpi.calls_today || 0} звонков`),
      el('span', {}, ` из ${kpi.target || 30} • успехи: ${kpi.wins_today || 0}`),
    );
    // Список.
    if (!r.tasks?.length) {
      list.append(emptyState({ icon: '✅', title: 'Нет задач', description: 'В этой категории лидов нет.' }));
      return;
    }
    for (const t of r.tasks) renderLeadCard(list, t, reload);
  }

  scopeBar.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => { currentScope = b.dataset.k; reload(); });
  });
  campFilter.addEventListener('change', () => { currentCampaign = campFilter.value || null; reload(); });

  await reload();
}

function renderLeadCard(container, t, onDone) {
  const phoneDigits = (t.phone || '').replace(/\D/g, '');
  const telHref = phoneDigits ? `tel:+${phoneDigits.replace(/^8/, '7')}` : '#';
  const card = el('div', {
    style: {
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
      padding: '12px', marginBottom: '10px',
    },
  });
  const priorityColors = { A: '#ef4444', B: '#f59e0b', C: '#94a3b8' };
  const priorityBadge = t.priority
    ? el('span', {
        style: {
          display: 'inline-block', minWidth: '22px', textAlign: 'center',
          padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
          background: priorityColors[t.priority] || '#6b7280', color: '#fff', marginRight: '6px',
        },
      }, t.priority)
    : null;
  const title = t.company_name
    ? `${t.company_name}${t.first_name && t.first_name !== 'Без имени' ? ' • ' + t.first_name : ''}`
    : `${t.first_name || 'Без имени'} ${t.last_name || ''}`.trim();
  const meta = [];
  if (t.region) meta.push(`🗺 ${t.region}`);
  if (t.city) meta.push(`📍 ${t.city}`);
  if (t.industry) meta.push(`🏢 ${t.industry}`);
  if (t.size_hint) meta.push(`⭐ ${t.size_hint}`);
  if (t.campaign_name) meta.push(`📢 ${t.campaign_name}`);

  const lastLine = t.last_attempt_at
    ? el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' } },
        `Последний контакт: ${fmtDateTime(t.last_attempt_at)}${t.last_note ? ' — «' + t.last_note.slice(0, 80) + '»' : ''}`,
      )
    : null;

  const outcomeChip = t.qualification
    ? el('span', {
        style: {
          padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
          background: OUTCOME_COLORS[t.qualification] + '22',
          color: OUTCOME_COLORS[t.qualification],
        },
      }, OUTCOME_LABELS[t.qualification] || t.qualification)
    : null;

  card.append(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
      el('div', {},
        el('div', { style: { fontWeight: '600', fontSize: '15px' } }, priorityBadge, title, ' ', outcomeChip),
        el('div', { style: { fontSize: '13px', color: '#374151', marginTop: '2px' } }, meta.join(' • ')),
      ),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('a', { href: telHref, style: {
          padding: '8px 14px', background: '#22c55e', color: '#fff', borderRadius: '6px',
          textDecoration: 'none', fontWeight: '600',
        } }, '📞 ', t.phone || 'нет тел.'),
        el('button', {
          class: 'btn btn-primary',
          onClick: () => openAttemptModal(t, onDone),
        }, 'Записать результат'),
        el('button', {
          class: 'btn',
          onClick: () => openLeadCardModal(t.id),
        }, '📄'),
      ),
    ),
    lastLine,
  );
  container.append(card);
}

// ============================================================
// МОДАЛКА: карточка лида с историей.
// ============================================================
async function openLeadCardModal(leadId) {
  const modal = openModal('Карточка лида', el('div', {}, '⏳ Загрузка…'), { primaryLabel: 'Закрыть', onSubmit: () => true });
  try {
    const { lead, attempts } = await api.callingLead(leadId);
    const body = el('div', {});
    const points = Array.isArray(lead.campaign_required_points) ? lead.campaign_required_points : [];
    body.append(
      el('div', { style: { marginBottom: '12px' } },
        el('div', { style: { fontWeight: '600', fontSize: '16px' } },
          lead.company_name || `${lead.first_name} ${lead.last_name || ''}`,
        ),
        el('div', { style: { color: '#6b7280', fontSize: '13px' } },
          [lead.city, lead.industry, lead.inn ? 'ИНН ' + lead.inn : null].filter(Boolean).join(' • '),
        ),
        el('div', { style: { marginTop: '6px' } },
          lead.phone ? el('a', { href: `tel:+${lead.phone.replace(/\D/g, '')}` }, `📞 ${lead.phone}`) : null,
          ' ',
          lead.email ? el('a', { href: `mailto:${lead.email}` }, `✉️ ${lead.email}`) : null,
          ' ',
          lead.website ? el('a', { href: lead.website, target: '_blank' }, `🌐 сайт`) : null,
        ),
      ),
    );
    if (lead.campaign_name) {
      body.append(el('div', { style: { padding: '8px', background: '#f9fafb', borderRadius: '6px', marginBottom: '12px' } },
        el('div', { style: { fontWeight: '600', fontSize: '13px' } }, '📢 ', lead.campaign_name),
        lead.campaign_description ? el('div', { style: { fontSize: '12px', whiteSpace: 'pre-wrap' } }, lead.campaign_description) : null,
        points.length ? el('div', { style: { marginTop: '6px' } },
          el('div', { style: { fontSize: '11px', fontWeight: '600', color: '#6b7280' } }, 'Обязательные пункты разговора:'),
          el('ul', { style: { margin: '4px 0 0 20px', fontSize: '13px' } },
            ...points.map((p) => el('li', {}, p)),
          ),
        ) : null,
      ));
    }
    body.append(el('div', { style: { fontWeight: '600', marginBottom: '8px' } }, `История попыток (${attempts.length}):`));
    if (!attempts.length) body.append(el('div', { style: { color: '#9ca3af' } }, 'Пока не было'));
    for (const a of attempts) {
      body.append(el('div', {
        style: { padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '6px', fontSize: '13px' },
      },
        el('div', {}, el('b', {}, OUTCOME_LABELS[a.outcome] || a.outcome), ' — ', fmtDateTime(a.at), ' • ', a.user_name || '—'),
        a.note ? el('div', { style: { color: '#374151', marginTop: '4px' } }, a.note) : null,
        a.next_call_at ? el('div', { style: { color: '#6b7280', fontSize: '12px', marginTop: '2px' } }, 'Перезвон: ', fmtDateTime(a.next_call_at)) : null,
      ));
    }
    // Замена body в модалке.
    const modalBody = document.querySelector('.modal-body, .modal-content > div');
    if (modalBody) { clear(modalBody); modalBody.append(body); }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ============================================================
// МОДАЛКА: результат звонка.
// ============================================================
function openAttemptModal(lead, onDone) {
  const outcomeSel = el('select', { style: { width: '100%', padding: '8px' } });
  for (const [k, v] of Object.entries(OUTCOME_LABELS)) outcomeSel.append(el('option', { value: k }, v));
  const noteArea = el('textarea', { rows: 3, style: { width: '100%', padding: '8px' }, placeholder: 'О чём договорились / что услышали' });
  const nextCallInput = el('input', { type: 'datetime-local', style: { width: '100%', padding: '8px' } });
  const nextCallWrap = el('div', { style: { marginTop: '8px', display: 'none' } },
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Перезвонить когда:'),
    nextCallInput,
  );
  outcomeSel.addEventListener('change', () => {
    nextCallWrap.style.display = outcomeSel.value === 'callback' ? 'block' : 'none';
  });

  // Обязательные пункты — чекбоксы (если есть у кампании).
  const pointsWrap = el('div', { style: { marginTop: '8px' } });
  // Ленивая загрузка карточки лида — чтобы получить required_points.
  api.callingLead(lead.id).then(({ lead: l }) => {
    const pts = Array.isArray(l.campaign_required_points) ? l.campaign_required_points : [];
    if (!pts.length) return;
    pointsWrap.append(el('div', { style: { fontSize: '12px', fontWeight: '600', color: '#374151' } }, 'Отметьте что затронули:'));
    for (const p of pts) {
      pointsWrap.append(el('label', { style: { display: 'block', fontSize: '13px', marginTop: '4px' } },
        el('input', { type: 'checkbox', dataset: { pt: p } }),
        ' ', p,
      ));
    }
  }).catch(() => {});

  const body = el('div', {},
    el('div', { style: { marginBottom: '8px', color: '#6b7280', fontSize: '13px' } },
      lead.company_name || `${lead.first_name} ${lead.last_name || ''}`, ' • ', lead.phone || '—',
    ),
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Результат звонка:'),
    outcomeSel,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Заметка:'),
    noteArea,
    nextCallWrap,
    pointsWrap,
  );

  openModal('Результат звонка', body, {
    primaryLabel: 'Сохранить',
    onSubmit: async () => {
      const outcome = outcomeSel.value;
      const nextCallVal = nextCallInput.value ? new Date(nextCallInput.value).toISOString() : null;
      if (outcome === 'callback' && !nextCallVal) { toast('Укажите дату следующего звонка', 'error'); return false; }
      const covered = Array.from(pointsWrap.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.dataset.pt);
      try {
        await api.callingAttempt(lead.id, {
          outcome, note: noteArea.value.trim() || null, next_call_at: nextCallVal, covered_points: covered,
        });
        toast('Результат записан', 'success');
        if (onDone) await onDone();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// ВКЛАДКА: КАМПАНИИ (admin)
// ============================================================
async function renderCampaigns(area) {
  const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
    el('div', { style: { color: '#6b7280', fontSize: '13px' } }, 'Кампания = один список для обзвона. Можно грузить CSV и распределять на менеджеров.'),
    el('button', { class: 'btn btn-primary', onClick: () => openCampaignForm(null, () => renderCampaigns(area)) }, '+ Новая кампания'),
  );
  const list = el('div', {});
  area.append(header, list);

  const r = await api.callingCampaigns();
  if (!r.campaigns?.length) {
    list.append(emptyState({ icon: '📢', title: 'Кампаний нет', description: 'Создайте первую и загрузите в неё базу для обзвона.' }));
    return;
  }
  for (const c of r.campaigns) {
    const conv = c.leads_converted || 0;
    const untouched = c.leads_untouched || 0;
    const done = (c.leads_total || 0) - untouched;
    list.append(el('div', {
      style: { padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '8px' },
    },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
        el('div', {},
          el('div', { style: { fontWeight: '600', fontSize: '15px' } }, c.name),
          el('div', { style: { fontSize: '12px', color: '#6b7280', marginTop: '2px' } },
            CAMPAIGN_TYPE_LABELS[c.type] || c.type,
            ' • ', CAMPAIGN_STATUS_LABELS[c.status] || c.status,
            ` • Лидов: ${c.leads_total || 0} (обработано ${done}${conv ? ', конверсий ' + conv : ''})`,
          ),
        ),
        el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          el('button', { class: 'btn btn-primary', onClick: () => openCampaignLeadsModal(c) }, '👁 Открыть'),
          el('button', { class: 'btn', onClick: () => openImportModal(c.id, () => renderCampaigns(area)) }, '📥 Импорт'),
          el('button', { class: 'btn', onClick: () => openDistributeModal(c.id, () => renderCampaigns(area)) }, '👥 Распределить'),
          el('button', { class: 'btn', onClick: () => openCampaignForm(c, () => renderCampaigns(area)) }, '✏️ Редактировать'),
        ),
      ),
    ));
  }
}

// ============================================================
// МОДАЛКА: содержимое кампании (список лидов + фильтры)
// ============================================================
function openCampaignLeadsModal(campaign) {
  const priorityColors = { A: '#ef4444', B: '#f59e0b', C: '#94a3b8' };
  const filterPri = el('select', { style: { padding: '4px', fontSize: '13px' } },
    el('option', { value: '' }, 'Все приоритеты'),
    el('option', { value: 'A' }, 'A (крупные)'),
    el('option', { value: 'B' }, 'B (средние)'),
    el('option', { value: 'C' }, 'C (малые)'),
  );
  const filterQual = el('select', { style: { padding: '4px', fontSize: '13px' } },
    el('option', { value: '' }, 'Все статусы'),
    el('option', { value: 'not_contacted' }, 'Не звонили'),
    el('option', { value: 'no_answer' }, '📵 Не ответил'),
    el('option', { value: 'callback' }, '⏰ Callback'),
    el('option', { value: 'qualified' }, '✅ Заинтересован'),
    el('option', { value: 'meeting_scheduled' }, '📅 Встреча'),
    el('option', { value: 'not_interested' }, '❌ Отказ'),
    el('option', { value: 'converted' }, '💰 Готов покупать'),
    el('option', { value: 'dead' }, '⚰️ Мёртвый'),
  );
  const filterOwner = el('select', { style: { padding: '4px', fontSize: '13px' } },
    el('option', { value: '' }, 'Все менеджеры'),
    el('option', { value: 'unassigned' }, 'Не назначены'),
  );
  const summary = el('div', { style: { fontSize: '13px', color: '#6b7280', marginBottom: '8px' } });
  const listBox = el('div', { style: { maxHeight: '55vh', overflowY: 'auto' } });

  const body = el('div', {},
    el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' } },
      filterPri, filterQual, filterOwner,
    ),
    summary,
    listBox,
  );

  async function load() {
    listBox.innerHTML = '⏳';
    const params = {};
    if (filterPri.value) params.priority = filterPri.value;
    if (filterQual.value) params.qualification = filterQual.value;
    if (filterOwner.value) params.owner_id = filterOwner.value;
    params.limit = 200;
    try {
      const r = await api.callingCampaignLeads(campaign.id, params);
      clear(listBox);
      clear(summary);
      summary.append(`Найдено: ${r.total}. Показано первые ${r.leads.length}.`);
      if (!r.leads.length) { listBox.append(el('div', { style: { color: '#9ca3af', padding: '12px' } }, 'Ничего не найдено с этими фильтрами.')); return; }
      const table = el('table', { style: { width: '100%', fontSize: '12px', borderCollapse: 'collapse' } });
      table.append(el('thead', {}, el('tr', { style: { background: '#f9fafb' } },
        ...['Приор.', 'Название', 'Телефон', 'Регион', 'Город', 'Тип', 'Статус', 'Менеджер', 'Последний звонок'].map((h) =>
          el('th', { style: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #e5e7eb' } }, h)),
      )));
      const tbody = el('tbody', {});
      for (const l of r.leads) {
        const priBadge = l.priority
          ? el('span', { style: { display: 'inline-block', minWidth: '18px', textAlign: 'center', padding: '1px 4px', borderRadius: '3px', fontSize: '10px', fontWeight: '700', background: priorityColors[l.priority] || '#6b7280', color: '#fff' } }, l.priority)
          : '—';
        const outcomeChip = l.qualification
          ? el('span', { style: { padding: '1px 6px', borderRadius: '8px', fontSize: '10px', background: OUTCOME_COLORS[l.qualification] + '22', color: OUTCOME_COLORS[l.qualification] } }, OUTCOME_LABELS[l.qualification] || l.qualification)
          : el('span', { style: { color: '#9ca3af' } }, 'Не звонили');
        tbody.append(el('tr', { style: { borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }, onClick: () => openLeadCardModal(l.id) },
          el('td', { style: { padding: '4px 6px' } }, priBadge),
          el('td', { style: { padding: '4px 6px', fontWeight: '500' } }, l.company_name || l.first_name || '—'),
          el('td', { style: { padding: '4px 6px' } }, l.phone || '—'),
          el('td', { style: { padding: '4px 6px' } }, l.region || '—'),
          el('td', { style: { padding: '4px 6px' } }, l.city || '—'),
          el('td', { style: { padding: '4px 6px', color: '#6b7280' } }, l.industry || '—'),
          el('td', { style: { padding: '4px 6px' } }, outcomeChip),
          el('td', { style: { padding: '4px 6px', color: '#6b7280' } }, l.owner_name || '—'),
          el('td', { style: { padding: '4px 6px', fontSize: '11px', color: '#9ca3af' } }, l.last_attempt_at ? fmtDateTime(l.last_attempt_at) : '—'),
        ));
      }
      table.append(tbody);
      listBox.append(table);
    } catch (e) {
      clear(listBox);
      listBox.append(el('div', { style: { color: '#ef4444' } }, `Ошибка: ${e.message}`));
    }
  }

  filterPri.addEventListener('change', load);
  filterQual.addEventListener('change', load);
  filterOwner.addEventListener('change', load);

  openModal(`📢 ${campaign.name}`, body, { primaryLabel: 'Закрыть', onSubmit: () => true, size: 'wide' });

  // Загрузка списка менеджеров для фильтра — параллельно.
  api.callingActiveManagers().then((r) => {
    for (const m of (r.managers || [])) filterOwner.append(el('option', { value: m.id }, m.name));
  }).catch(() => {});

  load();
}

function openCampaignForm(existing, onDone) {
  const nameI = el('input', { type: 'text', value: existing?.name || '', style: { width: '100%', padding: '8px' } });
  const typeSel = el('select', { style: { width: '100%', padding: '8px' } });
  for (const [k, v] of Object.entries(CAMPAIGN_TYPE_LABELS)) typeSel.append(el('option', { value: k, selected: existing?.type === k }, v));
  const statusSel = el('select', { style: { width: '100%', padding: '8px' } });
  for (const [k, v] of Object.entries(CAMPAIGN_STATUS_LABELS)) statusSel.append(el('option', { value: k, selected: (existing?.status || 'active') === k }, v));
  const descArea = el('textarea', { rows: 4, style: { width: '100%', padding: '8px' }, placeholder: 'Свободный скрипт разговора: контекст, что предлагаем, преимущества.' }, existing?.description || '');
  const pointsArea = el('textarea', { rows: 4, style: { width: '100%', padding: '8px' }, placeholder: 'По одному пункту в строке. Например:\nЧто производите?\nОбъёмы в месяц?\nКто принимает решения?\nТекущий поставщик?' },
    (existing?.required_points || []).join('\n'));
  const sourceI = el('input', { type: 'text', value: existing?.source || '', style: { width: '100%', padding: '8px' }, placeholder: '2ГИС, партнёр, ручной набор' });
  const targetI = el('input', { type: 'number', value: existing?.target_calls_per_day || 30, min: 0, max: 500, style: { width: '100%', padding: '8px' } });

  const body = el('div', {},
    el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Название кампании:'), nameI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Тип:'), typeSel,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Статус:'), statusSel,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Скрипт (свободный):'), descArea,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Обязательные пункты (по одному в строке):'), pointsArea,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Источник базы:'), sourceI,
    el('label', { style: { fontSize: '12px', fontWeight: '600', marginTop: '8px', display: 'block' } }, 'Целевое количество звонков/день на менеджера:'), targetI,
  );

  openModal(existing ? 'Редактировать кампанию' : 'Новая кампания', body, {
    primaryLabel: existing ? 'Сохранить' : 'Создать',
    onSubmit: async () => {
      const payload = {
        name: nameI.value.trim(),
        type: typeSel.value,
        status: statusSel.value,
        description: descArea.value.trim() || null,
        required_points: pointsArea.value.split('\n').map((s) => s.trim()).filter(Boolean),
        source: sourceI.value.trim() || null,
        target_calls_per_day: Number(targetI.value) || 30,
      };
      if (!payload.name) { toast('Название обязательно', 'error'); return false; }
      try {
        if (existing) await api.callingUpdateCampaign(existing.id, payload);
        else await api.callingCreateCampaign(payload);
        toast(existing ? 'Сохранено' : 'Кампания создана', 'success');
        if (onDone) await onDone();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: импорт CSV
// ============================================================
function openImportModal(campaignId, onDone) {
  const fileI = el('input', { type: 'file', accept: '.csv,.txt' });
  const preview = el('pre', { style: { fontSize: '11px', maxHeight: '200px', overflow: 'auto', background: '#f9fafb', padding: '6px', marginTop: '6px' } });
  const mapArea = el('div', { style: { marginTop: '8px', fontSize: '13px' } });
  const conflictSel = el('select', { style: { padding: '6px' } },
    el('option', { value: 'include' }, 'Загрузить всё (пометить дубли)'),
    el('option', { value: 'skip' }, 'Пропускать дубли из других кампаний'),
  );

  let parsedRows = [];
  let headers = [];

  fileI.addEventListener('change', async () => {
    const f = fileI.files?.[0]; if (!f) return;
    const text = await f.text();
    // Простой CSV-парсинг: разделитель , или ; определяем по первой строке.
    const firstLine = text.split(/\r?\n/)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { toast('Файл пустой', 'error'); return; }
    headers = lines[0].split(sep).map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase());
    parsedRows = lines.slice(1).map((ln) => {
      const cols = ln.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = cols[i] || '';
      return obj;
    });
    preview.textContent = `Заголовки: ${headers.join(' | ')}\n\nПервые 3 строки:\n${JSON.stringify(parsedRows.slice(0, 3), null, 2)}\n\nВсего строк: ${parsedRows.length}`;

    // Маппинг: подсказки авто.
    clear(mapArea);
    const targetFields = ['first_name', 'last_name', 'company_name', 'phone', 'email', 'city', 'industry', 'website', 'inn', 'size_hint', 'position', 'description'];
    const guess = (target) => {
      const hints = {
        first_name: ['first_name', 'firstname', 'имя'],
        last_name: ['last_name', 'lastname', 'фамилия'],
        company_name: ['company', 'company_name', 'организация', 'компания', 'название'],
        phone: ['phone', 'tel', 'телефон'],
        email: ['email', 'mail', 'почта'],
        city: ['city', 'город'],
        industry: ['industry', 'ниша', 'отрасль'],
        website: ['website', 'url', 'сайт'],
        inn: ['inn', 'инн'],
        size_hint: ['size', 'employees', 'сотрудников', 'размер'],
        position: ['position', 'должность'],
        description: ['description', 'notes', 'комментарий', 'заметка'],
      };
      for (const h of hints[target] || []) if (headers.includes(h)) return h;
      return '';
    };
    mapArea.append(el('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '4px' } }, 'Сопоставление колонок:'));
    const mappings = {};
    for (const tf of targetFields) {
      const sel = el('select', { dataset: { target: tf }, style: { padding: '4px', fontSize: '12px', marginLeft: '6px' } },
        el('option', { value: '' }, '— не грузить —'),
        ...headers.map((h) => el('option', { value: h, selected: h === guess(tf) }, h)),
      );
      mappings[tf] = sel;
      mapArea.append(el('div', { style: { marginBottom: '3px' } },
        el('span', { style: { display: 'inline-block', width: '110px', fontSize: '12px' } }, tf), sel,
      ));
    }
    // Сохраняем маппинги в замыкание.
    fileI.dataset.ready = '1';
    parsedRows._mappings = mappings;
  });

  const body = el('div', {},
    el('div', { style: { color: '#6b7280', fontSize: '13px', marginBottom: '8px' } },
      'Формат CSV: первая строка — заголовки. Разделитель , или ;. Обязательное поле — телефон.',
    ),
    fileI,
    preview,
    mapArea,
    el('div', { style: { marginTop: '8px' } },
      el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Что делать с дублями из других кампаний:'), conflictSel,
    ),
  );

  openModal('Импорт базы обзвона', body, {
    primaryLabel: 'Загрузить',
    onSubmit: async () => {
      if (!parsedRows.length) { toast('Выберите файл', 'error'); return false; }
      const mappings = parsedRows._mappings || {};
      // Применяем маппинг: строим финальные строки {target_field: value}.
      const finalRows = parsedRows.map((row) => {
        const out = {};
        for (const [tf, sel] of Object.entries(mappings)) {
          const src = sel.value;
          if (src && row[src] != null) out[tf] = row[src];
        }
        return out;
      }).filter((r) => r.phone);
      if (!finalRows.length) { toast('Ни в одной строке нет телефона', 'error'); return false; }
      try {
        const rep = await api.callingImport(campaignId, finalRows, conflictSel.value);
        toast(`Загружено ${rep.added} из ${rep.total}. Дубли: ${rep.skipped_duplicate_in_campaign + rep.skipped_duplicate_in_file}, без тел.: ${rep.skipped_no_contact}`, 'success');
        if (onDone) await onDone();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
}

// ============================================================
// МОДАЛКА: распределение лидов на менеджеров
// ============================================================
async function openDistributeModal(campaignId, onDone) {
  const bodyPlaceholder = el('div', {}, '⏳ Загрузка списка обзвонщиков…');
  openModal('Распределить лиды', bodyPlaceholder, {
    primaryLabel: 'Распределить',
    onSubmit: async () => {
      const checked = Array.from(bodyPlaceholder.querySelectorAll('input[type="checkbox"][data-mid]:checked')).map((c) => Number(c.dataset.mid));
      if (!checked.length) { toast('Выберите хотя бы одного менеджера', 'error'); return false; }
      const onlyU = bodyPlaceholder.querySelector('input[name="only_unassigned"]').checked;
      try {
        const r = await api.callingDistribute(campaignId, checked, onlyU);
        const lines = Object.entries(r.per_manager).map(([mid, n]) => `#${mid}: ${n}`).join(', ');
        toast(`Распределено ${r.distributed} лидов (${lines})`, 'success');
        if (onDone) await onDone();
        return true;
      } catch (e) { toast(e.message, 'error'); return false; }
    },
  });
  try {
    const r = await api.callingActiveManagers();
    clear(bodyPlaceholder);
    if (!r.managers?.length) {
      bodyPlaceholder.append(el('div', { style: { color: '#ef4444' } },
        'Нет активных обзвонщиков. Включите флаг «Активный обзвонщик» у нужных пользователей во вкладке «Обзвонщики».',
      ));
      return;
    }
    bodyPlaceholder.append(el('div', { style: { fontSize: '13px', marginBottom: '8px', color: '#6b7280' } },
      'Round-robin распределит непривязанные лиды по выбранным менеджерам.',
    ));
    for (const m of r.managers) {
      bodyPlaceholder.append(el('label', { style: { display: 'block', padding: '6px 0' } },
        el('input', { type: 'checkbox', dataset: { mid: m.id }, checked: true }),
        ` ${m.name} (${m.role})`,
        el('span', { style: { color: '#6b7280', fontSize: '12px' } }, ` — лимит ${m.calling_capacity || 30}`),
        m.calling_ready === false ? el('span', { style: { color: '#ef4444', fontSize: '12px' } }, ' • не готов') : null,
      ));
    }
    bodyPlaceholder.append(el('label', { style: { display: 'block', marginTop: '12px', fontSize: '13px' } },
      el('input', { type: 'checkbox', name: 'only_unassigned', checked: true }),
      ' Только новые (без назначения) — не перекидывать уже назначенных',
    ));
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// ВКЛАДКА: АНАЛИТИКА
// ============================================================
async function renderAnalytics(area) {
  // Сводка по всем кампаниям.
  const campHeader = el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px' } }, 'По кампаниям:');
  const campList = el('div', {});
  const mgrHeader = el('div', { style: { fontWeight: '600', fontSize: '14px', marginTop: '16px', marginBottom: '8px' } }, 'По менеджерам (за 30 дней):');
  const mgrList = el('div', {});
  area.append(campHeader, campList, mgrHeader, mgrList);

  const camps = await api.callingCampaigns();
  for (const c of camps.campaigns || []) {
    const stats = await api.callingCampaignStats(c.id);
    campList.append(el('div', {
      style: { padding: '10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '6px' },
    },
      el('div', { style: { fontWeight: '600' } }, c.name, ' ', el('span', { style: { color: '#6b7280', fontSize: '12px' } }, CAMPAIGN_STATUS_LABELS[c.status] || c.status)),
      el('div', { style: { fontSize: '13px', color: '#374151', marginTop: '4px' } },
        stats.by_qualification.map((q) => `${OUTCOME_LABELS[q.outcome] || q.outcome}: ${q.n}`).join(' • '),
      ),
      stats.overdue_callbacks ? el('div', { style: { fontSize: '13px', color: '#ef4444', marginTop: '2px' } }, `⚠️ Просроченных callbacks: ${stats.overdue_callbacks}`) : null,
    ));
  }

  const mgrs = await api.callingManagerStats(30);
  if (!mgrs.managers?.length) {
    mgrList.append(el('div', { style: { color: '#9ca3af' } }, 'Нет активных обзвонщиков.'));
    return;
  }
  const table = el('table', { style: { width: '100%', fontSize: '13px', borderCollapse: 'collapse' } });
  table.append(el('thead', {}, el('tr', {},
    ...['Менеджер', 'Попыток', 'Успехов', 'Уник. лидов', 'Активных дней', 'Последний'].map((h) =>
      el('th', { style: { textAlign: 'left', padding: '6px', borderBottom: '1px solid #e5e7eb' } }, h)),
  )));
  const tbody = el('tbody', {});
  for (const m of mgrs.managers) {
    tbody.append(el('tr', {},
      el('td', { style: { padding: '6px' } }, m.name),
      el('td', { style: { padding: '6px' } }, String(m.attempts_total)),
      el('td', { style: { padding: '6px', color: '#059669', fontWeight: '600' } }, String(m.wins)),
      el('td', { style: { padding: '6px' } }, String(m.unique_leads)),
      el('td', { style: { padding: '6px' } }, String(m.active_days)),
      el('td', { style: { padding: '6px', color: '#6b7280' } }, m.last_attempt_at ? fmtDateTime(m.last_attempt_at) : '—'),
    ));
  }
  table.append(tbody);
  mgrList.append(table);
}

// ============================================================
// ВКЛАДКА: ОБЗВОНЩИКИ (тумблеры активности + лимит)
// ============================================================
async function renderCallers(area) {
  area.append(el('div', { style: { color: '#6b7280', fontSize: '13px', marginBottom: '8px' } },
    'Включите «Активный обзвонщик» у нужных пользователей — только они видят раздел «Обзвон» и попадают в распределение.',
  ));
  const list = el('div', {});
  area.append(list);

  // Тянем всех пользователей — фильтруем на клиенте (обзвонщик может быть в любой роли).
  const r = await api.request?.('GET', '/api/users?limit=200') || await fetch('/api/users?limit=200', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('crm_token') },
  }).then((x) => x.json());
  const users = r.data || r.items || r.users || [];

  for (const u of users) {
    if (u.role === 'admin' || u.role === 'director_prod' || u.role === 'aus') continue;
    const activeChk = el('input', { type: 'checkbox', checked: !!u.is_active_caller });
    const capInput = el('input', { type: 'number', min: 0, max: 500, value: u.calling_capacity || 30, style: { width: '70px', padding: '4px' } });
    const save = async (payload) => {
      try {
        await fetch(`/api/users/${u.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('crm_token') },
          body: JSON.stringify(payload),
        }).then(async (x) => { if (!x.ok) throw new Error((await x.json()).error || x.statusText); });
        toast('Сохранено', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    activeChk.addEventListener('change', () => save({ is_active_caller: activeChk.checked }));
    capInput.addEventListener('change', () => save({ calling_capacity: Number(capInput.value) || 30 }));
    list.append(el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '4px' },
    },
      el('div', {},
        el('div', { style: { fontWeight: '500' } }, u.name),
        el('div', { style: { fontSize: '12px', color: '#6b7280' } }, `${u.email} • ${u.role}`),
      ),
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', fontSize: '13px' } },
        el('label', {}, activeChk, ' Активный'),
        el('label', {}, 'Лимит: ', capInput),
      ),
    ));
  }
}
