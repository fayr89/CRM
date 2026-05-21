import { api, clearSession, getStoredUser, getToken, setSession } from './api.js';
import { clear, el, toast, tr } from './ui.js';
import { renderDashboard, renderPipeline, renderResource } from './views.js';

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
];

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
          'Админ по умолчанию: admin@example.com / admin123 (поменяйте ADMIN_PASSWORD в настройках)',
        ),
      ),
    ),
  );
}

function renderShell() {
  clear(root);
  const main = el('main', { class: 'main' });

  const user = getStoredUser() || { name: '?', email: '', role: '' };

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'sidebar-brand' }, 'CRM'),
    el(
      'nav',
      { class: 'sidebar-nav' },
      ...NAV.map((n) =>
        el(
          'a',
          {
            href: n.hash,
            class: location.hash.startsWith(n.hash) ? 'active' : '',
          },
          n.label,
        ),
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
};

function renderApp() {
  if (!getToken()) {
    renderLogin();
    return;
  }
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    location.hash = '#/dashboard';
    return;
  }
  const main = renderShell();
  const handler = ROUTES[location.hash] || ROUTES['#/dashboard'];
  handler(main);
}

window.addEventListener('hashchange', renderApp);

renderApp();
