import { api, clearSession, getStoredUser, getToken, setSession } from './api.js';
import { clear, el, fmtDateTime, toast, tr } from './ui.js';
import {
  loadMarketplaces,
  openGlobalSearch,
  renderAcceptInvite,
  renderAnalytics,
  renderCashbox,
  renderDashboard,
  renderIntegrations,
  renderInvitations,
  renderOrders,
  renderPipeline,
  renderProducts,
  renderResource,
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
    title: 'Продажи',
    items: [
      { hash: '#/pipeline', label: 'Воронка', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/deals', label: 'Сделки', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/leads', label: 'Лиды', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/contacts', label: 'Контакты', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/companies', label: 'Компании', roles: SALES_ROLES, block: 'sales' },
      { hash: '#/activities', label: 'Задачи', roles: SALES_ROLES, block: 'sales' },
    ],
  },
  {
    title: 'Прямые продажи',
    items: [
      { hash: '#/orders', label: 'Прямые продажи', roles: SALES_ROLES, block: 'direct' },
      { hash: '#/products', label: 'Каталог', roles: ['admin', 'rop', 'manager', 'sales', 'aus', 'warehouse'], block: 'direct' },
      { hash: '#/cashbox', label: 'Касса', roles: SALES_ROLES, block: 'direct' },
    ],
  },
  {
    title: 'Склад',
    items: [{ hash: '#/shipping', label: 'Отгрузки', roles: ['admin', 'warehouse'] }],
  },
  {
    title: 'Управление',
    items: [
      { hash: '#/analytics', label: 'Аналитика', roles: ['admin', 'rop'] },
      { hash: '#/users', label: 'Пользователи', roles: ['admin', 'rop'] },
      { hash: '#/invitations', label: 'Приглашения', roles: ['admin', 'rop'] },
      { hash: '#/integrations', label: 'Интеграции', roles: ['admin', 'aus'] },
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

function renderLogin() {
  clear(root);
  const emailInput = el('input', { type: 'email', placeholder: 'Email', value: 'admin@example.com' });
  const passInput = el('input', { type: 'password', placeholder: 'Пароль' });
  const submit = async () => {
    try {
      const r = await api.login(emailInput.value, passInput.value);
      setSession(r.token, r.user);
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

// Переключение роли для просмотра (только админ). Возвращает null для остальных.
function buildRoleSwitcher(user) {
  const isAdmin = user.role === 'admin' || user.impersonating;
  if (!isAdmin) return null;

  const switchRole = async (role) => {
    try {
      const r = await api.impersonate(role);
      setSession(r.token, r.user);
      location.hash = '#/dashboard';
      renderApp();
    } catch (e) {
      toast(e.message || 'Ошибка', 'error');
    }
  };

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
  for (const group of NAV_GROUPS) {
    const items = group.items.filter((it) => navItemVisible(user, it));
    if (!items.length) continue;
    if (group.title) navChildren.push(el('div', { class: 'sidebar-group-title' }, group.title));
    for (const it of items) {
      navChildren.push(
        el('a', { href: it.hash, class: path.startsWith(it.hash) ? 'active' : '' }, it.label),
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

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'sidebar-brand' }, 'CRM'),
    searchBtn,
    bellBtn,
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

  root.append(el('div', { class: 'shell' }, sidebar, overlay, main), menuBtn);
  startNotificationsPolling(bellCounter);
  return main;
}

// --- Уведомления: дропдаун + поллинг каждые 20 секунд ---

let notifTimer = null;
let lastUnread = 0;

function stopNotificationsPolling() {
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = null;
  lastUnread = 0;
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

const ROUTES = {
  '#/dashboard': renderDashboard,
  '#/pipeline': renderPipeline,
  '#/companies': (m) => renderResource(m, 'companies'),
  '#/contacts': (m) => renderResource(m, 'contacts'),
  '#/leads': (m) => renderResource(m, 'leads'),
  '#/deals': (m) => renderResource(m, 'deals'),
  '#/activities': (m) => renderResource(m, 'activities'),
  '#/users': (m) => renderResource(m, 'users'),
  '#/invitations': renderInvitations,
  '#/orders': renderOrders,
  '#/shipping': renderShipping,
  '#/products': renderProducts,
  '#/cashbox': renderCashbox,
  '#/analytics': renderAnalytics,
  '#/integrations': renderIntegrations,
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
  handler(main);
}

window.addEventListener('hashchange', renderApp);

renderApp();

// Загружаем актуальный список площадок (один раз при старте, если авторизованы).
if (getToken()) {
  loadMarketplaces().then(() => {
    // если открыта страница, использующая площадки, перерисуем её
    const { path } = parseHash();
    if (['#/orders', '#/products'].includes(path)) renderApp();
  });
}
