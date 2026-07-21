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
    cache: 'no-store', // иначе браузер кэширует GET и отдаёт 304 (фронт трактует как ошибку)
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Тело — не JSON (обычно HTML-страница ошибки/таймаута Vercel). Даём понятную
    // ошибку вместо «Unexpected token '<'».
    const err = new Error(
      res.status === 504 || res.status === 502
        ? `Операция не уложилась в лимит времени (HTTP ${res.status}). Попробуйте сузить объём.`
        : `Сервер вернул не-JSON ответ (HTTP ${res.status}).`,
    );
    err.status = res.status;
    throw err;
  }
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
  impersonate: (role) => request('POST', '/api/auth/impersonate', { body: { role } }),
  me: () => request('GET', '/api/auth/me'),
  changePassword: (current, next) => request('POST', '/api/auth/change-password', { body: { current, next } }),
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
  insights: (query) => request('GET', '/api/dashboard/insights', { query }),
  dailySales: (query) => request('GET', '/api/dashboard/daily-sales', { query }),

  // Avito / прямые продажи
  markOrderWaiting: (id) => request('POST', `/api/orders/${id}/mark-waiting`),
  markOrderReady: (id) => request('POST', `/api/orders/${id}/mark-ready`),
  recheckOrderStock: (id) => request('POST', `/api/orders/${id}/recheck-stock`),
  splitOrder: (id, body) => request('POST', `/api/orders/${id}/split`, { body }),
  extractItem: (id, itemId, body) => request('POST', `/api/orders/${id}/items/${itemId}/extract`, { body }),
  unshipOrder: (id) => request('POST', `/api/orders/${id}/unship`),
  confirmShipping: (id) => request('POST', `/api/orders/${id}/confirm-shipping`),
  refreshProductStocks: (product_ids) => request('POST', '/api/products/refresh-stocks', { body: { product_ids } }),
  downloadLabelsPdf: async (ids) => {
    const token = getToken();
    const url = `/api/orders/labels.pdf?ids=${ids.join(',')}`;
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : `labels-${new Date().toISOString().slice(0, 10)}.pdf`;
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  },
  reserveOrder: (id, opts = {}) => request('POST', `/api/orders/${id}/reserve`, {
    query: opts.force ? { force: '1' } : {},
  }),
  suggestClients: (q) => request('GET', '/api/orders/clients/suggest', { query: { q } }),
  clientRecentItems: (params) => request('GET', '/api/orders/clients/recent-items', { query: params }),
  checkShipmentQr: (qr, excludeId) => request('GET', '/api/orders/check-shipment-qr', {
    query: { qr, ...(excludeId ? { exclude_id: String(excludeId) } : {}) },
  }),
  unreserveOrder: (id) => request('POST', `/api/orders/${id}/unreserve`),
  shipOrder: (id) => request('POST', `/api/orders/${id}/ship`),
  shipBulk: (ids) => request('POST', '/api/orders/ship-bulk', { body: { ids } }),
  returnsList: (status) => request('GET', '/api/orders/returns/list', { query: { status } }),
  resolveReturn: (id, resolution, proof) =>
    request('POST', `/api/orders/${id}/return-resolve`, { body: { resolution, proof } }),
  lostList: (status) => request('GET', '/api/orders/lost/list', { query: { status } }),
  voidLoss: (id) => request('POST', `/api/orders/${id}/lost-void`),
  completeOrder: (id) => request('POST', `/api/orders/${id}/complete`),
  cancelOrder: (id, reason) =>
    request('POST', `/api/orders/${id}/cancel`, { body: { reason } }),
  cancelReasonsList: () => request('GET', '/api/products/cancel-reasons/list'),
  setCancelReasons: (cancel_reasons) =>
    request('PUT', '/api/products/cancel-reasons', { body: { cancel_reasons } }),

  confirmPayment: (id) => request('POST', `/api/payments/${id}/confirm`),
  rejectPayment: (id, reason) =>
    request('POST', `/api/payments/${id}/reject`, { body: { reason } }),

  cashbox: (userId, managerId, projectId) =>
    request('GET', userId ? `/api/cashbox/${userId}` : '/api/cashbox', {
      query: {
        ...(managerId ? { manager_id: String(managerId) } : {}),
        ...(projectId ? { project_id: String(projectId) } : {}),
      },
    }),

  importProductNames: (csv) => request('POST', '/api/products/import-names', { body: { csv } }),

  // Интеграции и уведомления
  notifications: (unread) =>
    request('GET', '/api/notifications', { query: unread ? { unread: 'true' } : {} }),
  readNotification: (id) => request('POST', `/api/notifications/${id}/read`),
  readAllNotifications: () => request('POST', '/api/notifications/read-all'),
  // Обратная связь
  submitFeedback: (body) => request('POST', '/api/feedback', { body }),
  listFeedback: (query) => request('GET', '/api/feedback', { query }),
  getFeedback: (id) => request('GET', `/api/feedback/by-id/${id}`),
  feedbackOpenCount: () => request('GET', '/api/feedback/open-count'),
  updateFeedback: (id, body) => request('PATCH', `/api/feedback/${id}`, { body }),
  myFeedback: () => request('GET', '/api/feedback/my'),
  approveFeedback: (id) => request('POST', `/api/feedback/${id}/approve`),
  rejectFeedback: (id, reason) => request('POST', `/api/feedback/${id}/reject`, { body: { reason } }),
  feedbackMessages: (id) => request('GET', `/api/feedback/${id}/messages`),
  postFeedbackMessage: (id, text, attachments) => request('POST', `/api/feedback/${id}/messages`, { body: { text, attachments: attachments?.length ? attachments : undefined } }),
  // МойСклад: интеграция списания/прихода
  msStatus: () => request('GET', '/api/admin/ms/status'),
  msInit: (body) => request('POST', '/api/admin/ms/init', { body }),
  msListJobs: (query) => request('GET', '/api/admin/ms/jobs', { query }),
  msRetryJob: (id) => request('POST', `/api/admin/ms/jobs/${id}/retry`),
  msUndoJob: (id) => request('POST', `/api/admin/ms/jobs/${id}/undo`),
  msRunNow: () => request('POST', '/api/admin/ms/jobs/run-now'),
  // Аудит-лог
  listAudit: (query) => request('GET', '/api/admin/audit', { query }),

  // Баннеры уведомлений на сайте
  activeBanners: () => request('GET', '/api/notice-banners/active'),
  listBanners: () => request('GET', '/api/notice-banners'),
  createBanner: (body) => request('POST', '/api/notice-banners', { body }),
  updateBanner: (id, body) => request('PATCH', `/api/notice-banners/${id}`, { body }),
  deleteBanner: (id) => request('DELETE', `/api/notice-banners/${id}`),

  // AI-предложения (inbox админа)
  listAiProposals: (query) => request('GET', '/api/ai-proposals', { query }),
  aiProposalsPendingCount: () => request('GET', '/api/ai-proposals/pending-count'),
  createAiProposal: (body) => request('POST', '/api/ai-proposals', { body }),
  decideAiProposal: (id, decision, notes) =>
    request('PATCH', `/api/ai-proposals/${id}`, { body: { decision, notes } }),
  deleteAiProposal: (id) => request('DELETE', `/api/ai-proposals/${id}`),
  aiProposalMessages: (id) => request('GET', `/api/ai-proposals/${id}/messages`),
  postAiProposalMessage: (id, text, userName) => request('POST', `/api/ai-proposals/${id}/messages`, { body: { text, user_name: userName || undefined } }),

  // Производственный модуль (PROD)
  postProductionFact: (orderId, day, fact_qty, note) => request('POST', `/api/production-orders/${orderId}/fact`, { body: { day, fact_qty, note } }),
  approveProductionOrder: (orderId) => request('POST', `/api/production-orders/${orderId}/approve`),
  updateContractStage: (contractId, stage, body) => request('PATCH', `/api/contracts/${contractId}/stages/${stage}`, { body }),
  consumeContractMaterial: (contractId, body) => request('POST', `/api/contracts/${contractId}/materials`, { body }),
  logContractLabor: (contractId, body) => request('POST', `/api/contracts/${contractId}/labor`, { body }),
  addContractOtherExpense: (contractId, body) => request('POST', `/api/contracts/${contractId}/other-expenses`, { body }),

  // P&L производства
  productionPL: (from, to) => request('GET', '/api/production/p-and-l', { query: { from, to } }),
  productionExpenses: (from, to) => request('GET', '/api/production/expenses', { query: { from, to } }),
  createProductionExpense: (body) => request('POST', '/api/production/expenses', { body }),
  updateProductionExpense: (id, body) => request('PATCH', `/api/production/expenses/${id}`, { body }),
  deleteProductionExpense: (id) => request('DELETE', `/api/production/expenses/${id}`),

  // Настройки производства + МС-склады
  productionSettings: () => request('GET', '/api/production-settings'),
  updateProductionSettings: (body) => request('PUT', '/api/production-settings', { body }),
  msStores: (refresh) => request('GET', '/api/production-settings/ms-stores', { query: refresh ? { refresh: '1' } : {} }),

  // Тестовая зона «Поставки → Доставки» (фиче-флаг + скелет)
  supplyDeliveryFlag: () => request('GET', '/api/supply-delivery/flag'),
  supplyDeliverySettings: () => request('GET', '/api/supply-delivery/settings'),
  saveSupplyDeliverySettings: (body) => request('PUT', '/api/supply-delivery/settings', { body }),
  supplyDeliveryOverview: () => request('GET', '/api/supply-delivery/overview'),
  // Справочники модуля (Phase 2a)
  sdTariffs: () => request('GET', '/api/supply-delivery/packaging-tariffs'),
  sdCreateTariff: (body) => request('POST', '/api/supply-delivery/packaging-tariffs', { body }),
  sdUpdateTariff: (id, body) => request('PUT', `/api/supply-delivery/packaging-tariffs/${id}`, { body }),
  sdDeleteTariff: (id) => request('DELETE', `/api/supply-delivery/packaging-tariffs/${id}`),
  sdTariffHistory: (id) => request('GET', `/api/supply-delivery/packaging-tariffs/${id}/history`),
  sdReward: () => request('GET', '/api/supply-delivery/reward'),
  sdSaveReward: (body) => request('PUT', '/api/supply-delivery/reward', { body }),
  sdThresholds: () => request('GET', '/api/supply-delivery/thresholds'),
  sdSaveThreshold: (sku, body) => request('PUT', `/api/supply-delivery/thresholds/${encodeURIComponent(sku)}`, { body }),
  sdDeleteThreshold: (sku) => request('DELETE', `/api/supply-delivery/thresholds/${encodeURIComponent(sku)}`),
  // Каналы + юрлица + API-ключи (только админ)
  sdChannelAccounts: () => request('GET', '/api/supply-delivery/channel-accounts'),
  sdCreateChannelAccount: (body) => request('POST', '/api/supply-delivery/channel-accounts', { body }),
  sdUpdateChannelAccount: (id, body) => request('PUT', `/api/supply-delivery/channel-accounts/${id}`, { body }),
  sdDeleteChannelAccount: (id) => request('DELETE', `/api/supply-delivery/channel-accounts/${id}`),
  // Финансовые параметры (Phase 2b)
  sdFinanceSettings: () => request('GET', '/api/supply-delivery/finance-settings'),
  sdSaveFinanceSettings: (body) => request('PUT', '/api/supply-delivery/finance-settings', { body }),
  // Продуктовый справочник (МойСклад-номенклатура)
  sdProductDirectory: (search) => request('GET', '/api/supply-delivery/product-directory', { query: { search } }),
  sdSaveProductDirectory: (productId, body) => request('PUT', `/api/supply-delivery/product-directory/${productId}`, { body }),
  // Сопоставление номенклатуры канала ⇄ внутренней (Phase 3)
  sdChannelMap: (channel, status, search, channelAccountId, visibility) => request('GET', '/api/supply-delivery/channel-map', { query: { channel, status, search, channel_account_id: channelAccountId || '', visibility: visibility || 'active' } }),
  sdHideChannel: (id, hidden) => request('PUT', `/api/supply-delivery/channel-map/${id}/hidden`, { body: { hidden } }),
  sdHideMatchedChannel: (channel) => request('POST', '/api/supply-delivery/channel-map/hide-matched', { body: { channel } }),
  sdImportChannelMap: (body) => request('POST', '/api/supply-delivery/channel-map/import', { body }),
  sdPullWb: (channel_account_id) => request('POST', '/api/supply-delivery/channel-map/pull-wb', { body: { channel_account_id } }),
  sdAutoMatchChannel: (channel) => request('POST', '/api/supply-delivery/channel-map/auto-match', { body: { channel } }),
  sdAutoMatchArticle: (channel) => request('POST', '/api/supply-delivery/channel-map/auto-match-article', { body: { channel } }),
  sdMatchChannel: (id, set_id) => request('PUT', `/api/supply-delivery/channel-map/${id}/match`, { body: { set_id } }),
  sdUnmatchChannel: (id) => request('PUT', `/api/supply-delivery/channel-map/${id}/unmatch`),
  sdDeleteChannelMap: (id) => request('DELETE', `/api/supply-delivery/channel-map/${id}`),
  // Книга сетов (артикул МП = комбинация артикулов склада + упаковка)
  sdSets: (search) => request('GET', '/api/supply-delivery/sets', { query: { search } }),
  sdCreateSet: (body) => request('POST', '/api/supply-delivery/sets', { body }),
  sdPullMsSets: (folder, offset) => request('POST', '/api/supply-delivery/sets/pull-ms', { body: { folder, offset: offset || 0 } }),
  sdPushMsSet: (id) => request('POST', `/api/supply-delivery/sets/${id}/push-ms`),
  sdSet: (id) => request('GET', `/api/supply-delivery/sets/${id}`),
  sdUpdateSet: (id, body) => request('PUT', `/api/supply-delivery/sets/${id}`, { body }),
  sdDeleteSet: (id) => request('DELETE', `/api/supply-delivery/sets/${id}`),
  sdAddSetComponent: (id, body) => request('POST', `/api/supply-delivery/sets/${id}/components`, { body }),
  sdDeleteSetComponent: (id, cid) => request('DELETE', `/api/supply-delivery/sets/${id}/components/${cid}`),
  sdAddSetPackaging: (id, body) => request('POST', `/api/supply-delivery/sets/${id}/packaging`, { body }),
  sdDeleteSetPackaging: (id, pid) => request('DELETE', `/api/supply-delivery/sets/${id}/packaging/${pid}`),
  sdAddSetChannelLink: (id, body) => request('POST', `/api/supply-delivery/sets/${id}/channel-links`, { body }),
  // WB ФБС: процесс поставки
  sdWbCreateSupply: (id) => request('POST', `/api/supply-delivery/supplies/${id}/wb/create-supply`),
  sdWbNewOrders: (id) => request('GET', `/api/supply-delivery/supplies/${id}/wb/new-orders`),
  sdWbAttachOrder: (id, body) => request('POST', `/api/supply-delivery/supplies/${id}/wb/attach-order`, { body }),
  sdWbBarcode: (id) => request('GET', `/api/supply-delivery/supplies/${id}/wb/barcode`),
  sdWbDeliver: (id) => request('POST', `/api/supply-delivery/supplies/${id}/wb/deliver`),
  sdWbReshipment: (channelAccountId) => request('GET', '/api/supply-delivery/wb/reshipment', { query: { channel_account_id: channelAccountId } }),
  sdWbAccounts: () => request('GET', '/api/supply-delivery/wb/accounts'),
  sdChannelAccountsLite: () => request('GET', '/api/supply-delivery/channel-accounts-lite'),
  // Поставки
  sdSupplies: () => request('GET', '/api/supply-delivery/supplies'),
  sdCreateSupply: (body) => request('POST', '/api/supply-delivery/supplies', { body }),
  sdSupply: (id) => request('GET', `/api/supply-delivery/supplies/${id}`),
  sdUpdateSupply: (id, body) => request('PUT', `/api/supply-delivery/supplies/${id}`, { body }),
  sdDeleteSupply: (id) => request('DELETE', `/api/supply-delivery/supplies/${id}`),
  sdAddSupplyItem: (id, body) => request('POST', `/api/supply-delivery/supplies/${id}/items`, { body }),
  sdDeleteSupplyItem: (id, itemId) => request('DELETE', `/api/supply-delivery/supplies/${id}/items/${itemId}`),
  // Доставки
  sdDeliveries: () => request('GET', '/api/supply-delivery/deliveries'),
  sdCreateDelivery: (body) => request('POST', '/api/supply-delivery/deliveries', { body }),
  sdDelivery: (id) => request('GET', `/api/supply-delivery/deliveries/${id}`),
  sdUpdateDelivery: (id, body) => request('PUT', `/api/supply-delivery/deliveries/${id}`, { body }),
  sdDeleteDelivery: (id) => request('DELETE', `/api/supply-delivery/deliveries/${id}`),
  sdAttachSupply: (id, supply_id) => request('POST', `/api/supply-delivery/deliveries/${id}/supplies`, { body: { supply_id } }),
  sdDetachSupply: (id, supplyId) => request('DELETE', `/api/supply-delivery/deliveries/${id}/supplies/${supplyId}`),
  sdAddPackaging: (id, body) => request('POST', `/api/supply-delivery/deliveries/${id}/packaging`, { body }),
  sdDeletePackaging: (id, lineId) => request('DELETE', `/api/supply-delivery/deliveries/${id}/packaging/${lineId}`),

  // Производственный заказ: выполнить N штук + синхронизация материала с МС
  executeProductionOrder: (id, qty, day) => request('POST', `/api/production-orders/${id}/execute`, { body: { qty, day } }),
  syncMaterialMs: (id) => request('POST', `/api/materials/${id}/sync-ms`),
  wipeOperational: () => request('POST', '/api/admin/wipe-operational', { body: { confirm: 'УДАЛИТЬ' } }),

  // МАХ-бот
  maxMe: () => request('GET', '/api/max/me'),
  maxBindCode: () => request('POST', '/api/max/bind-code'),
  maxUnbind: () => request('POST', '/api/max/unbind'),
  maxAdminStatus: () => request('GET', '/api/max/admin/status'),
  maxAdminSetToken: (token) => request('POST', '/api/max/admin/token', { body: { token } }),
  maxAdminSetWebhook: (url) => request('POST', '/api/max/admin/webhook', { body: { url } }),
  maxAdminTest: () => request('POST', '/api/max/admin/test'),
  maxAdminDiagnose: () => request('GET', '/api/max/admin/diagnose'),

  // Типы уведомлений + настройки пользователя
  notificationTypes: () => request('GET', '/api/notification-prefs/types'),
  myNotificationPrefs: () => request('GET', '/api/notification-prefs/me'),
  updateNotificationPrefs: (prefs) => request('PATCH', '/api/notification-prefs/me', { body: { prefs } }),

  // Проекты (справочник для классификации лидов/сделок/контактов/компаний).
  projectsList: (onlyActive = false) => request('GET', '/api/projects', { query: onlyActive ? { active: 'true' } : {} }),
  projectCreate: (body) => request('POST', '/api/projects', { body }),
  projectUpdate: (id, body) => request('PATCH', `/api/projects/${id}`, { body }),
  projectDelete: (id) => request('DELETE', `/api/projects/${id}`),
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
  productsForMarketplace: (marketplace, search, warehouse) =>
    request('GET', '/api/products/for-marketplace', { query: { marketplace, search, warehouse } }),
  popularProducts: (marketplace, days, warehouse) =>
    request('GET', '/api/products/popular', { query: { marketplace, days, warehouse } }),
  setProductPrice: (id, body) => request('PUT', `/api/products/${id}/prices`, { body }),
  deleteProductPrice: (id, marketplace, warehouse) =>
    request('DELETE', `/api/products/${id}/prices/${encodeURIComponent(marketplace)}`, { query: { warehouse } }),
  importMoysklad: (token) =>
    request('POST', '/api/products/import/moysklad', { body: token ? { token } : {} }),
  refreshMoyskladStock: (token) =>
    request('POST', '/api/products/import/moysklad-stock', { body: token ? { token } : {} }),
  refreshMoyskladStores: (token, offset) =>
    request('POST', '/api/products/import/moysklad-stores', { body: { token: token || undefined, offset: offset || 0 } }),
  warehousesList: () => request('GET', '/api/products/warehouses/list'),
  setHiddenWarehouses: (hidden) =>
    request('PUT', '/api/products/warehouses/hidden', { body: { hidden } }),
  setDefaultWarehouse: (warehouse) =>
    request('PUT', '/api/products/warehouses/default', { body: { warehouse } }),
  setDefaultMarketplace: (marketplace) =>
    request('PUT', '/api/products/marketplaces/default', { body: { marketplace } }),
  setDefaultPaymentMethod: (payment_method) =>
    request('PUT', '/api/products/payment-method/default', { body: { payment_method } }),
  marketplacesList: () => request('GET', '/api/products/marketplaces/list'),
  setMarketplaces: (marketplaces) =>
    request('PUT', '/api/products/marketplaces', { body: { marketplaces } }),
  suppliersList: () => request('GET', '/api/products/suppliers/list'),
  deliveryMethodsList: () => request('GET', '/api/products/delivery-methods/list'),
  setDeliveryMethods: (delivery_methods) =>
    request('PUT', '/api/products/delivery-methods', { body: { delivery_methods } }),
  moyskladTokenStatus: () => request('GET', '/api/products/moysklad-token/status'),
  setMoyskladToken: (token) => request('PUT', '/api/products/moysklad-token', { body: { token } }),

  // Расписание отгрузок
  warehouseSchedule: () => request('GET', '/api/warehouse/schedule'),
  updateWarehouseSchedule: (body) => request('PUT', '/api/warehouse/schedule', { body }),
  readyToShip: (params) => request('GET', '/api/orders/ready-to-ship', { query: params }),
  shippedArchive: (params = {}) => request('GET', '/api/orders/shipped-archive', { query: params }),

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

  downloadAssemblyList: async (params = {}) => {
    const token = getToken();
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    const url = `/api/orders/assembly-list.csv${qs ? '?' + qs : ''}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : `assembly-${new Date().toISOString().slice(0, 10)}.csv`;
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  },

  // Прайсы: шаблон, загрузка, правила цен
  importPrices: (rows) => request('POST', '/api/products/import/prices', { body: { rows } }),
  purgeLegacyPrices: () => request('POST', '/api/products/prices/purge-legacy'),
  pricingSettings: () => request('GET', '/api/pricing/settings'),
  savePricingSettings: (body) => request('PUT', '/api/pricing/settings', { body }),

  // Ревизия прайса + ознакомление менеджеров (баннер + статус, без блокировок)
  priceRevision: () => request('GET', '/api/pricing/revision'),
  acknowledgePrice: () => request('POST', '/api/pricing/acknowledge'),
  priceAckStatus: () => request('GET', '/api/pricing/ack-status'),

  downloadPriceTemplate: async (marketplace, warehouse) => {
    const token = getToken();
    const params = new URLSearchParams();
    if (marketplace) params.set('marketplace', marketplace);
    if (warehouse) params.set('warehouse', warehouse);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const url = `/api/products/price-template.csv${qs}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `price-template-${marketplace || 'all'}-${warehouse || 'all'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(downloadUrl);
  },
};
