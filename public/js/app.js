import { api, clearSession, getStoredUser, getToken, setSession } from './api.js';
import { clear, el, toast, tr } from './ui.js';
import {
  renderAcceptInvite,
  renderDashboard,
  renderInvitations,
  renderPipeline,
  renderResource,
} from './views.js';

const root = document.getElementById('app');

const NAV = [
  { hash: '#/dashboard', label: 'Дашборд' },
  { hash: '#/pipeline', label: 'Воронка' },
  { hash: '#/deals', label: 'Сделки' },
  { hash: '#/leads', label: 'Лиды' },
  { hash: '#/contacts', label: 'Контакты' },
  { hash: '#/companies', label: 'Компании' },
  { hash: '#/activities', label: 'Задачи' },
  { hash: '#/users', label: 'Пользователи' },
  { hash: '#/invitations', label: 'Приглашения', roles: ['admin', 'manager'] },
];

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

function renderShell() {
  clear(root);
  const main = el('main', { class: 'main' });

  const user = getStoredUser() || { name: '?', email: '', role: '' };
  const userRole = user.role || 'sales';
  const visibleNav = NAV.filter((n) => !n.roles || n.roles.includes(userRole));
  const { path } = parseHash();

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'sidebar-brand' }, 'CRM'),
    el(
      'nav',
      { class: 'sidebar-nav' },
      ...visibleNav.map((n) =>
        el('a', { href: n.hash, class: path.startsWith(n.hash) ? 'active' : '' }, n.label),
      ),
    ),
    el(
      'div',
      { class: 'sidebar-user' },
      el('div', { class: 'name' }, user.name),
      el('div', {}, user.email),
      el('div', {}, `Роль: ${tr('role', user.role) || user.role}`),
      el(
        'button',
        {
          onClick: () => {
            clearSession();
            location.hash = '#/login';
            renderApp();
          },
        },
        'Выйти',
      ),
    ),
  );

  root.append(el('div', { class: 'shell' }, sidebar, main));
  return main;
}

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
