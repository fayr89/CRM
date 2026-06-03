import { api, clearSession, getStoredUser, getToken, setSession } from './api.js';
import { clear, el, fmtDateTime, toast, tr } from './ui.js';
import {
  loadDeliveryMethods,
  loadMarketplaces,
  openGlobalSearch,
  renderAcceptInvite,
  renderAnalytics,
  renderAudit,
  renderCashbox,
  renderDashboard,
  openFeedbackDialog,
  openMaxBindDialog,
  renderAiInbox,
  renderFeedback,
  renderMyFeedback,
  renderMyProfile,
  renderIntegrations,
  renderInvitations,
  renderDirectOrders,
  renderOrders,
  renderLostGoods,
  renderPipeline,
  renderProducts,
  renderResource,
  renderReturns,
  renderShipping,
} from './views.js';

const root = document.getElementById('app');

// Роли, которые работают с блоками продаж
const SALES_ROLES = ['admin', 'rop', 'manager', 'sales'];

// Меню разбито на блоки. item.roles — кто видит, item.block — требуется блок
// доступа ('sales'/'direct') для менеджера/продажника (admin/rop видят без блока).
const NAV_GROUPS = [
  { items: [{ hash: '#/dashboard', label: 'Дашборд' }] },
  {
    title: 'B2B (менеджеры по продажам)',
    items: [
      // Раздел для sales-менеджеров: воронка, сделки, лиды, контакты, B2B-заказы.
      // Видимость: пользователь с access_blocks включающим 'sales'.
      { hash: '#/pipeline', label: 'Воронка', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/deals', label: 'Сделки', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/direct-orders', label: 'B2B заказы', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/leads', label: 'Лиды', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/contacts', label: 'Контакты', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/companies', label: 'Компании', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/activities', label: 'Задачи', roles: SALES_ROLES, block: 'sales' },
    ],
  },
  {
    title: 'Авито (менеджеры площадок)',
    items: [
      // Раздел для Avito/marketplace-менеджеров: только заказы с площадок + касса.
      // Видимость: пользователь с access_blocks включающим 'direct'.
      { hash: '#/orders', label: 'Продажи с площадок', roles: SALES_ROLES, block: 'direct' },
      { hash: '#/cashbox', label: 'Касса', roles: [...SALES_ROLES, 'finance'], block: 'direct' },
    ],
  },
  {
    title: 'Каталог',
    items: [
      // Каталог нужен обоим блокам продаж + складу/АУС — без блок-ограничения.
      { hash: '#/products', label: 'Каталог', roles: ['admin', 'rop', 'manager', 'sales', 'aus', 'warehouse'] },
    ],
  },
  {
    title: 'Склад',
    items: [
      { hash: '#/shipping', label: 'Отгрузки', roles: ['admin', 'warehouse'] },
      { hash: '#/returns', label: 'Возвраты', roles: ['admin', 'warehouse', 'aus'] },
      { hash: '#/lost-goods', label: 'Потерянные товары', roles: ['admin', 'warehouse', 'aus'] },
    ],
  },
  {
    title: 'Управление',
    items: [
      { hash: '#/analytics', label: 'Аналитика', roles: ['admin', 'rop'] },
      { hash: '#/users', label: 'Пользователи', roles: ['admin', 'rop'] },
      { hash: '#/invitations', label: 'Приглашения', roles: ['admin', 'rop'] },
      { hash: '#/integrations', label: 'Настройки', roles: ['admin', 'aus'] },
      { hash: '#/feedback', label: 'Обращения', roles: ['admin'] },
      { hash: '#/audit', label: 'История действий', roles: ['admin'] },
      { hash: '#/ai-inbox', label: '🤖 AI-предложения', roles: ['admin'] },
    ],
  },
];

// Видим ли пункт меню для пользователя: по роли и (для менеджера) по блоку доступа.
function navItemVisible(user, item) {
  if (!item.roles) return true; // Дашборд — всем
  if (!item.roles.includes(user.role)) return false;
  if (item.block && (user.role === 'manager' || user.role === 'sales')) {
    const blocks = user.access_blocks
      ? user.access_blocks.split(',').map((b) => b.trim()).filter(Boolean)
      : ['sales', 'direct'];
    return blocks.includes(item.block);
  }
  return true;
}

// Парсим query-параметры из hash вида #/route?a=1&b=2
function parseHash() {
  const h = location.hash || '';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  return { path, params };
}

// Бэкап БД при логине админа — скачиваем JSON-дамп не чаще раза в сутки.
async function maybeBackupOnLogin() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('last_backup_date') === today) return;
    const res = await fetch('/api/admin/backup', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const name = cd.match(/filename="(.+)"/)?.[1] || 'crm-backup.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    localStorage.setItem('last_backup_date', today);
    toast('Бэкап базы скачан', 'success');
  } catch {
    // бэкап не критичен для входа — молча игнорируем сбой
  }
}

// Автообновление остатков из МойСклад при входе (admin/aus), не чаще раза в сутки.
async function maybeRefreshStockOnLogin() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('last_stock_refresh') === today) return;
    const r = await api.refreshMoyskladStock(); // токен берётся из БД
    if (r && r.updated != null) {
      localStorage.setItem('last_stock_refresh', today);
      toast(`Остатки обновлены: ${r.updated}`, 'success');
    }
  } catch {
    // нет токена/недоступно — не критично, обновят вручную кнопкой
  }
}

function renderLogin() {
  clear(root);
  const emailInput = el('input', { type: 'email', placeholder: 'Email', value: 'admin@example.com' });
  const passInput = el('input', { type: 'password', placeholder: 'Пароль' });
  const submit = async () => {
    try {
      const r = await api.login(emailInput.value, passInput.value);
      setSession(r.token, r.user);
      if (r.user.role === 'admin') maybeBackupOnLogin();
      if (['admin', 'aus'].includes(r.user.role)) maybeRefreshStockOnLogin();
      location.hash = '#/dashboard';
      renderApp();
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
        el('h1', {}, 'Вход в CRM'),
        el('div', { class: 'form-row' }, el('label', {}, 'Email'), emailInput),
        el('div', { class: 'form-row' }, el('label', {}, 'Пароль'), passInput),
        el(
          'button',
          { class: 'btn btn-primary', type: 'submit', style: { width: '100%' } },
          'Войти',
        ),
        el(
          'div',
          { class: 'hint' },
          'Войти можно только по приглашению от менеджера или администратора.',
        ),
      ),
    ),
  );
}

// Переключение роли просмотра (имперсонация). role='admin' — вернуться к себе.
async function switchRole(role) {
  try {
    const r = await api.impersonate(role);
    setSession(r.token, r.user);
    location.hash = '#/dashboard';
    renderApp();
  } catch (e) {
    toast(e.message || 'Ошибка', 'error');
  }
}

// Переключение роли для просмотра (только админ). Возвращает null для остальных.
function buildRoleSwitcher(user) {
  const isAdmin = user.role === 'admin' || user.impersonating;
  if (!isAdmin) return null;

  if (user.impersonating) {
    return el(
      'div',
      { class: 'role-switcher' },
      el('div', { class: 'role-impersonating' }, `👁 Просмотр как ${tr('role', user.role) || user.role}`),
      el('button', { class: 'role-back-btn', onClick: () => switchRole('admin') }, '← Вернуться к админу'),
    );
  }

  const select = el(
    'select',
    { class: 'role-switch-select' },
    el('option', { value: '' }, 'Смотреть как роль…'),
    el('option', { value: 'manager' }, 'Менеджер'),
    el('option', { value: 'rop' }, 'РОП'),
    el('option', { value: 'warehouse' }, 'Склад'),
    el('option', { value: 'aus' }, 'АУС'),
    el('option', { value: 'finance' }, 'Фин. управляющий'),
  );
  select.addEventListener('change', () => {
    if (select.value) switchRole(select.value);
  });
  return el('div', { class: 'role-switcher' }, select);
}

function renderShell() {
  clear(root);
  const main = el('main', { class: 'main' });

  const user = getStoredUser() || { name: '?', email: '', role: '' };
  const { path } = parseHash();

  // Строим навигацию по группам: показываем только видимые пункты и непустые группы.
  const navChildren = [];
  // Бейдж с числом открытых обращений — рядом с пунктом «Обращения».
  const feedbackCounter = el('span', { class: 'nav-counter', style: { display: 'none' } });
  // Бейдж AI-предложений ждущих решения админа.
  const aiInboxCounter = el('span', { class: 'nav-counter', style: { display: 'none' } });
  for (const group of NAV_GROUPS) {
    const items = group.items.filter((it) => navItemVisible(user, it));
    if (!items.length) continue;
    if (group.title) navChildren.push(el('div', { class: 'sidebar-group-title' }, group.title));
    for (const it of items) {
      const extras = it.hash === '#/feedback' ? [feedbackCounter]
        : it.hash === '#/ai-inbox' ? [aiInboxCounter]
        : [];
      navChildren.push(
        el('a', { href: it.hash, class: path.startsWith(it.hash) ? 'active' : '' },
          el('span', {}, it.label), ...extras),
      );
    }
  }

  const searchBtn = el(
    'button',
    {
      class: 'sidebar-search',
      onClick: () => openGlobalSearch(),
      title: 'Глобальный поиск (Ctrl+K)',
    },
    el('span', {}, '🔍 Поиск'),
    el('kbd', {}, 'Ctrl K'),
  );

  const bellCounter = el('span', { class: 'bell-counter', style: { display: 'none' } });
  const bellBtn = el(
    'a',
    {
      class: 'sidebar-bell',
      href: '#',
      onClick: (e) => {
        e.preventDefault();
        openNotificationsDropdown(bellBtn, bellCounter);
      },
      title: 'Уведомления',
    },
    el('span', {}, '🔔 Уведомления'),
    bellCounter,
  );

  const myFeedbackCounter = el('span', { class: 'nav-counter', style: { display: 'none' } });
  const myFeedbackBtn = el(
    'a',
    {
      href: '#/my-feedback',
      class: 'sidebar-bell' + (path.startsWith('#/my-feedback') ? ' active' : ''),
      title: 'Мои обращения и подтверждение выполненных задач',
    },
    el('span', {}, '📋 Мои обращения'),
    myFeedbackCounter,
  );
  // Подгружаем счётчик «требует подтверждения» в фоне.
  (async () => {
    try {
      const r = await api.myFeedback();
      const n = r?.awaiting_count || 0;
      if (n > 0) {
        myFeedbackCounter.textContent = String(n);
        myFeedbackCounter.style.display = '';
      }
    } catch { /* ignore */ }
  })();

  const feedbackBtn = el(
    'a',
    {
      class: 'sidebar-bell',
      href: '#',
      onClick: (e) => { e.preventDefault(); openFeedbackDialog(); },
      title: 'Сообщить о проблеме или задать вопрос',
    },
    el('span', {}, '📮 Помощь / Баг'),
  );

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'sidebar-brand' }, 'CRM'),
    searchBtn,
    bellBtn,
    feedbackBtn,
    myFeedbackBtn,
    el('nav', { class: 'sidebar-nav' }, ...navChildren),
    el(
      'div',
      { class: 'sidebar-user' },
      el('div', { class: 'name' }, user.name),
      el('div', {}, user.email),
      el('div', {}, `Роль: ${tr('role', user.role) || user.role}`),
      buildRoleSwitcher(user),
      el(
        'button',
        {
          class: 'btn btn-sm',
          style: { marginTop: '6px', width: '100%' },
          onClick: () => openMaxBindDialog(),
        },
        '🔔 Подключить МАХ',
      ),
      el(
        'a',
        {
          href: '#/my-profile',
          class: 'btn btn-sm',
          style: { marginTop: '6px', width: '100%', display: 'block', textAlign: 'center', textDecoration: 'none' },
        },
        '👤 Мой профиль',
      ),
      el(
        'button',
        {
          onClick: () => {
            stopNotificationsPolling();
            clearSession();
            location.hash = '#/login';
            renderApp();
          },
        },
        'Выйти',
      ),
    ),
  );

  // Бургер-меню для мобильных: кнопка открывает sidebar, overlay закрывает.
  const overlay = el('div', { class: 'sidebar-overlay' });
  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  };
  // Кнопка-бургер + рядом маленький индикатор «кто залогинен» — чтобы на мобиле
  // (особенно в PWA, у которого свой изолированный localStorage от Safari) сразу
  // было видно, под какой ролью открыто приложение. Без этого админ мог не знать,
  // что в PWA он на самом деле вошёл как менеджер из прошлой сессии.
  const userBadge = el(
    'div',
    {
      class: 'mobile-user-badge',
      title: `${user.name} · ${user.email} · ${tr('role', user.role) || user.role}`,
    },
    el('span', { class: 'mobile-user-badge-name' }, user.name || '?'),
    el('span', { class: 'mobile-user-badge-role' }, tr('role', user.role) || user.role),
  );
  const menuBtn = el(
    'button',
    {
      class: 'mobile-menu-btn',
      'aria-label': 'Меню',
      onClick: () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('open');
      },
    },
    '☰',
  );
  overlay.addEventListener('click', closeMenu);
  // Клик по пункту навигации закрывает меню (на мобильном).
  sidebar.querySelectorAll('.sidebar-nav a').forEach((a) => a.addEventListener('click', closeMenu));

  // Если активна имперсонация — full-width оранжевая полоса САМОЙ ВЕРХНЕЙ строкой.
  // Раньше была плавающей в углу и пряталась за нотч / другие баннеры → админ
  // думал, что видит свои данные, а реально смотрел глазами менеджера и не понимал
  // куда делись чужие заказы.
  if (user.impersonating) {
    root.append(
      el(
        'div',
        { class: 'impersonation-bar' },
        el('span', {}, `👁 Просмотр как ${tr('role', user.role) || user.role}`),
        el('button', { onClick: () => switchRole('admin') }, '← Вернуться к админу'),
      ),
    );
  }

  // Полоска уведомлений сверху (баннеры от админа). Закрытые сохраняются в localStorage по id.
  const noticeBar = el('div', { class: 'notice-bar' });
  root.append(noticeBar);
  loadNoticeBanners(noticeBar);
  // Подсказка для пользователей iPhone-Safari: «добавьте на домой» — за 1 раз
  // показываем, потом 3 дня молчим (или навсегда, если юзер ткнул «×»/установил).
  loadIosInstallBanner(noticeBar);

  root.append(el('div', { class: 'shell' }, sidebar, overlay, main), menuBtn, userBadge);

  startNotificationsPolling(bellCounter);
  if (user.role === 'admin') {
    startFeedbackPolling(feedbackCounter);
    startAiInboxPolling(aiInboxCounter);
  }
  return main;
}

function getDismissedBanners() {
  try { return new Set(JSON.parse(localStorage.getItem('crm_dismissed_banners') || '[]')); }
  catch { return new Set(); }
}
function setDismissedBanners(set) {
  localStorage.setItem('crm_dismissed_banners', JSON.stringify([...set]));
}
// Баннер «Установите на iPhone как приложение» — показывается только в iOS-Safari,
// если PWA ещё не установлено. Закрытие по «×» прячет на 3 дня (localStorage TS).
// Кнопка «Как установить» раскрывает инлайн-инструкцию из 3 шагов.
function loadIosInstallBanner(container) {
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  if (!isIos) return;
  // Уже стоит на домашнем экране → больше не уговариваем.
  const standalone = window.navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches;
  if (standalone) return;
  // Только Safari (Chrome/Firefox/Edge на iOS не дают «Добавить на экран Домой» в нашем виде).
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  if (!isSafari) return;
  // Снулжена ли пауза «не показывать N дней».
  const until = Number(localStorage.getItem('ios_install_banner_until') || 0);
  if (until && Date.now() < until) return;

  const banner = el('div', { class: 'notice-banner notice-info ios-install-banner' });
  const text = el('span', { class: 'notice-text' },
    el('span', { style: { marginRight: '6px' } }, '📲'),
    'Добавьте CRM на экран «Домой» — открывается как приложение, без адресной строки.',
  );
  const howBtn = el('button', { class: 'btn btn-xs', style: { marginRight: '6px' } }, 'Как установить');
  const closeBtn = el('button', {
    class: 'notice-close',
    title: 'Скрыть на 3 дня',
    onClick: () => {
      const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
      localStorage.setItem('ios_install_banner_until', String(Date.now() + THREE_DAYS));
      banner.remove();
      details.remove();
    },
  }, '×');

  // Инлайн-инструкция: появляется под баннером по клику «Как установить».
  // Без модалки, чтобы юзер видел реальные кнопки Safari пока читает шаги.
  const details = el('div', { class: 'ios-install-details', style: { display: 'none' } },
    el('ol', { style: { margin: '8px 0 4px', paddingLeft: '24px', lineHeight: '1.6' } },
      el('li', {}, 'Тапни на иконку ',
        el('b', {}, '«Поделиться»'), ' внизу экрана (квадрат со стрелкой вверх ⬆️).'),
      el('li', {}, 'Прокрути список вниз и выбери ',
        el('b', {}, '«На экран Домой»'), ' (Add to Home Screen).'),
      el('li', {}, 'Нажми ',
        el('b', {}, '«Добавить»'),
        ' справа сверху — иконка CRM появится на главном экране.'),
    ),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' } },
      'После установки открывай CRM иконкой — Safari больше не нужен.'),
  );
  howBtn.addEventListener('click', () => {
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
    howBtn.textContent = details.style.display === 'none' ? 'Как установить' : 'Скрыть';
  });

  banner.append(text, howBtn, closeBtn);
  container.append(banner, details);
}

async function loadNoticeBanners(container) {
  try {
    const r = await api.activeBanners();
    const banners = r.data || [];
    const dismissed = getDismissedBanners();
    container.innerHTML = '';
    for (const b of banners) {
      if (b.dismissible && dismissed.has(b.id)) continue;
      const cls = `notice-banner notice-${b.kind || 'info'}`;
      const node = el('div', { class: cls },
        el('span', { class: 'notice-text' }, b.text),
        b.dismissible ? el('button', {
          class: 'notice-close',
          title: 'Скрыть до следующего входа',
          onClick: () => {
            const d = getDismissedBanners();
            d.add(b.id);
            setDismissedBanners(d);
            node.remove();
          },
        }, '×') : null,
      );
      container.append(node);
    }
  } catch { /* нет банеров — ничего страшного */ }
}

let aiInboxTimer = null;
function startAiInboxPolling(counter) {
  async function tick() {
    try {
      const r = await api.aiProposalsPendingCount();
      const n = r?.count || 0;
      if (n > 0) {
        counter.textContent = String(n);
        counter.style.display = '';
      } else {
        counter.style.display = 'none';
      }
    } catch { /* ignore */ }
  }
  tick();
  if (aiInboxTimer) clearInterval(aiInboxTimer);
  aiInboxTimer = setInterval(tick, 60_000);
}

// --- Уведомления: дропдаун + поллинг каждые 20 секунд ---

let notifTimer = null;
let lastUnread = 0;

function stopNotificationsPolling() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = null;
  lastUnread = 0;
  if (feedbackTimer) clearInterval(feedbackTimer);
  feedbackTimer = null;
}

function startNotificationsPolling(counter) {
  if (notifTimer) clearInterval(notifTimer);
  const tick = async () => {
    try {
      const r = await api.notifications(false);
      const unread = r.unread || 0;
      if (unread > 0) {
        counter.textContent = String(unread);
        counter.style.display = 'inline-block';
      } else {
        counter.style.display = 'none';
      }
      // Toast для новых
      if (unread > lastUnread && lastUnread > 0 && r.data?.length) {
        const newest = r.data.find((n) => !n.read_at);
        if (newest) toast(`${newest.title}: ${newest.body || ''}`, 'success');
      }
      lastUnread = unread;
    } catch {
      /* ignore */
    }
  };
  tick();
  notifTimer = setInterval(tick, 20000);
}

let feedbackTimer = null;
function startFeedbackPolling(counter) {
  if (feedbackTimer) clearInterval(feedbackTimer);
  const tick = async () => {
    try {
      const r = await api.feedbackOpenCount();
      const open = r.count || 0;
      if (open > 0) {
        counter.textContent = String(open);
        counter.style.display = 'inline-block';
      } else {
        counter.style.display = 'none';
      }
    } catch { /* ignore */ }
  };
  tick();
  feedbackTimer = setInterval(tick, 60000);
}

function openNotificationsDropdown(anchor, counter) {
  const existing = document.querySelector('.notif-dropdown');
  if (existing) {
    existing.remove();
    return;
  }
  const dropdown = el('div', { class: 'notif-dropdown' }, el('div', { class: 'loading' }, 'Загрузка…'));
  document.body.append(dropdown);

  const rect = anchor.getBoundingClientRect();
  dropdown.style.left = `${rect.right + 8}px`;
  dropdown.style.top = `${rect.top}px`;

  const cleanup = () => {
    dropdown.remove();
    document.removeEventListener('click', closeOnClick);
  };
  const closeOnClick = (e) => {
    if (!dropdown.contains(e.target) && !anchor.contains(e.target)) cleanup();
  };
  setTimeout(() => document.addEventListener('click', closeOnClick), 0);

  api.notifications(false).then((r) => {
    clear(dropdown);
    const items = r.data || [];
    dropdown.append(
      el(
        'div',
        { class: 'notif-header' },
        el('strong', {}, 'Уведомления'),
        items.some((n) => !n.read_at)
          ? el(
              'button',
              {
                class: 'btn btn-sm',
                onClick: async () => {
                  await api.readAllNotifications();
                  counter.style.display = 'none';
                  lastUnread = 0;
                  cleanup();
                },
              },
              'Прочитать все',
            )
          : null,
      ),
    );
    if (items.length === 0) {
      dropdown.append(el('div', { class: 'notif-empty' }, 'Уведомлений нет'));
      return;
    }
    for (const n of items) {
      dropdown.append(
        el(
          'a',
          {
            class: 'notif-item' + (n.read_at ? '' : ' unread'),
            href: n.link || '#',
            onClick: () => {
              cleanup();
              if (!n.read_at) api.readNotification(n.id).catch(() => {});
            },
          },
          el('div', { class: 'notif-title' }, n.title),
          n.body ? el('div', { class: 'notif-body' }, n.body) : null,
          el('div', { class: 'notif-time' }, fmtDateTime(n.created_at)),
        ),
      );
    }
  });
}

// Глобальный хоткей Ctrl+K / Cmd+K
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (getToken()) openGlobalSearch();
  }
});

// Все route-handlers принимают (main, opts) — opts содержит { params: URLSearchParams }
// для глубоких ссылок (например, #/orders?id=123 откроет конкретный заказ).
const ROUTES = {
  '#/dashboard': renderDashboard,
  '#/pipeline': renderPipeline,
  '#/companies': (m, opts) => renderResource(m, 'companies', opts),
  '#/contacts': (m, opts) => renderResource(m, 'contacts', opts),
  '#/leads': (m, opts) => renderResource(m, 'leads', opts),
  '#/deals': (m, opts) => renderResource(m, 'deals', opts),
  '#/activities': (m, opts) => renderResource(m, 'activities', opts),
  '#/users': (m, opts) => renderResource(m, 'users', opts),
  '#/invitations': renderInvitations,
  '#/orders': renderOrders,
  '#/direct-orders': renderDirectOrders,
  '#/shipping': renderShipping,
  '#/returns': renderReturns,
  '#/lost-goods': renderLostGoods,
  '#/products': renderProducts,
  '#/cashbox': renderCashbox,
  '#/analytics': renderAnalytics,
  '#/integrations': renderIntegrations,
  '#/feedback': renderFeedback,
  '#/my-feedback': renderMyFeedback,
  '#/my-profile': renderMyProfile,
  '#/audit': renderAudit,
  '#/ai-inbox': renderAiInbox,
};

function renderApp() {
  const { path, params } = parseHash();

  // Приглашение — доступно без авторизации
  if (path === '#/accept') {
    const token = params.get('token');
    if (!token) {
      location.hash = '#/login';
      return;
    }
    clear(root);
    renderAcceptInvite(root, token, (result) => {
      setSession(result.token, result.user);
      location.hash = '#/dashboard';
      renderApp();
    });
    return;
  }

  if (!getToken()) {
    renderLogin();
    return;
  }
  if (!path || path === '#/' || path === '#') {
    location.hash = '#/dashboard';
    return;
  }
  const main = renderShell();
  const handler = ROUTES[path] || ROUTES['#/dashboard'];
  // Передаём query-параметры из hash в роут-handler — нужно, чтобы из уведомления
  // («#/orders?id=123») сразу открылся detail-диалог сущности.
  handler(main, { params });
}

window.addEventListener('hashchange', renderApp);

renderApp();

// Загружаем актуальные площадки и способы доставки (один раз при старте, если авторизованы).
if (getToken()) {
  Promise.all([loadMarketplaces(), loadDeliveryMethods()]).then(() => {
    const { path } = parseHash();
    if (['#/orders', '#/products'].includes(path)) renderApp();
  });
}

// === Service Worker: детект обновлений и баннер «Доступно обновление» ===
// Без SW юзеры на iPhone-PWA сидели бы на старой версии пока сами не переустановят
// приложение. SW проверяет sw.js на каждой навигации (updateViaCache: none),
// и если контент изменился → ставит новую версию в waiting и шлёт 'updatefound'.
// Юзер видит «🔄 Доступно обновление» — клик skipWaiting + reload.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const handleUpdate = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // installed + есть controller = это НЕ первая установка, а обновление.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(worker);
          }
        });
      };
      if (reg.waiting) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => handleUpdate(reg.installing));

      // Проверяем обновления при возврате во вкладку и каждые 10 мин.
      const checkForUpdates = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdates();
      });
      setInterval(checkForUpdates, 10 * 60 * 1000);
    })
    .catch((e) => { console.warn('[sw] не удалось зарегистрировать:', e.message); });

  // После активации новой версии — перезагружаем страницу автоматически.
  let reloadInFlight = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadInFlight) return;
    reloadInFlight = true;
    location.reload();
  });
}

function showUpdateBanner(waitingWorker) {
  if (document.querySelector('.sw-update-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'sw-update-banner';
  banner.innerHTML = `
    <span>🔄 Доступна новая версия CRM</span>
    <button class="sw-update-btn">Обновить</button>
    <button class="sw-update-dismiss" title="Скрыть до следующей загрузки">×</button>
  `;
  banner.querySelector('.sw-update-btn').addEventListener('click', () => {
    banner.remove();
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });
  banner.querySelector('.sw-update-dismiss').addEventListener('click', () => banner.remove());
  document.body.append(banner);
}
