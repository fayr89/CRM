const TOKEN_KEY = 'crm_token';
const USER_KEY = 'crm_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request(method, path, { body, query } = {}) {
  const token = getToken();
  let url = path;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data?.details;
    if (res.status === 401) {
      clearSession();
      location.hash = '#/login';
    }
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request('POST', '/api/auth/login', { body: { email, password } }),
  me: () => request('GET', '/api/auth/me'),
  acceptInvite: (token, name, password) =>
    request('POST', '/api/auth/accept-invite', { body: { token, name, password } }),
  inviteByToken: (token) => request('GET', `/api/invitations/by-token/${encodeURIComponent(token)}`),

  list: (resource, query) => request('GET', `/api/${resource}`, { query }),
  get: (resource, id) => request('GET', `/api/${resource}/${id}`),
  create: (resource, body) => request('POST', `/api/${resource}`, { body }),
  update: (resource, id, body) => request('PATCH', `/api/${resource}/${id}`, { body }),
  remove: (resource, id) => request('DELETE', `/api/${resource}/${id}`),

  // Специальные действия
  pipeline: (query) => request('GET', '/api/deals/pipeline', { query }),
  winDeal: (id) => request('POST', `/api/deals/${id}/win`),
  loseDeal: (id, reason) =>
    request('POST', `/api/deals/${id}/lose`, { body: { reason } }),
  convertLead: (id, body) =>
    request('POST', `/api/leads/${id}/convert`, { body: body || {} }),
  completeActivity: (id) =>
    request('POST', `/api/activities/${id}/complete`),

  dashboard: (query) => request('GET', '/api/dashboard/stats', { query }),
  recent: (query) => request('GET', '/api/dashboard/recent', { query }),

  // Avito / прямые продажи
  reserveOrder: (id) => request('POST', `/api/orders/${id}/reserve`),
  shipOrder: (id) => request('POST', `/api/orders/${id}/ship`),
  completeOrder: (id) => request('POST', `/api/orders/${id}/complete`),
  cancelOrder: (id, reason) =>
    request('POST', `/api/orders/${id}/cancel`, { body: { reason } }),

  confirmPayment: (id) => request('POST', `/api/payments/${id}/confirm`),
  rejectPayment: (id, reason) =>
    request('POST', `/api/payments/${id}/reject`, { body: { reason } }),

  cashbox: (userId) =>
    request('GET', userId ? `/api/cashbox/${userId}` : '/api/cashbox'),

  // Интеграции и уведомления
  notifications: (unread) =>
    request('GET', '/api/notifications', { query: unread ? { unread: 'true' } : {} }),
  readNotification: (id) => request('POST', `/api/notifications/${id}/read`),
  readAllNotifications: () => request('POST', '/api/notifications/read-all'),
  search: (q) => request('GET', '/api/search', { query: { q } }),

  apiTokens: () => request('GET', '/api/api-tokens'),
  createApiToken: (body) => request('POST', '/api/api-tokens', { body }),
  revokeApiToken: (id) => request('POST', `/api/api-tokens/${id}/revoke`),
  deleteApiToken: (id) => request('DELETE', `/api/api-tokens/${id}`),

  webhooks: () => request('GET', '/api/webhooks'),
  createWebhook: (body) => request('POST', '/api/webhooks', { body }),
  updateWebhook: (id, body) => request('PATCH', `/api/webhooks/${id}`, { body }),
  deleteWebhook: (id) => request('DELETE', `/api/webhooks/${id}`),
  webhookDeliveries: (id) => request('GET', `/api/webhooks/${id}/deliveries`),

  // Каталог товаров
  productsForMarketplace: (marketplace, search) =>
    request('GET', '/api/products/for-marketplace', { query: { marketplace, search } }),
  popularProducts: (marketplace, days) =>
    request('GET', '/api/products/popular', { query: { marketplace, days } }),
  setProductPrice: (id, body) => request('PUT', `/api/products/${id}/prices`, { body }),
  deleteProductPrice: (id, marketplace) =>
    request('DELETE', `/api/products/${id}/prices/${encodeURIComponent(marketplace)}`),
  importMoysklad: (token) =>
    request('POST', '/api/products/import/moysklad', { body: token ? { token } : {} }),
  refreshMoyskladStock: (token) =>
    request('POST', '/api/products/import/moysklad-stock', { body: token ? { token } : {} }),

  // Расписание отгрузок
  warehouseSchedule: () => request('GET', '/api/warehouse/schedule'),
  updateWarehouseSchedule: (body) => request('PUT', '/api/warehouse/schedule', { body }),
  readyToShip: () => request('GET', '/api/orders/ready-to-ship'),

  // Аналитика для руководства
  analyticsRevenue: (days) => request('GET', '/api/analytics/revenue', { query: { days } }),
  analyticsManagers: (days) => request('GET', '/api/analytics/managers', { query: { days } }),
  analyticsMarketplaces: (days) =>
    request('GET', '/api/analytics/marketplaces', { query: { days } }),
  analyticsProducts: (days) => request('GET', '/api/analytics/products', { query: { days } }),
  analyticsFunnel: (days) => request('GET', '/api/analytics/funnel', { query: { days } }),
  analyticsSummary: (days) => request('GET', '/api/analytics/summary', { query: { days } }),

  // Экспорт заказов в CSV — возвращает URL для скачивания (с авторизацией через query)
  ordersExportUrl: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    return `/api/orders/export.csv${qs ? '?' + qs : ''}`;
  },

  // Прямое скачивание CSV через fetch с авторизацией
  downloadOrdersCsv: async (params = {}) => {
    const token = getToken();
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    const url = `/api/orders/export.csv${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  },
};
