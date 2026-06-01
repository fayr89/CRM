// Регистр типов уведомлений. Используется и бэком (для notify-чека prefs),
// и фронтом (отображение списка и шаблонов в Настройках).
// roles — кому это уведомление реально приходит (исходя из вызывающего кода).
export const NOTIFICATION_TYPES = [
  {
    key: 'order.created',
    label: 'Новый заказ — складу',
    description: 'Менеджер создал заказ, склад должен зарезервировать товар.',
    template: '{{client}} · {{amount}} — заказ ожидает резерва',
    roles: ['warehouse', 'admin'],
  },
  {
    key: 'order.reserved',
    label: 'Заказ зарезервирован',
    description: 'Склад зарезервировал ваш заказ, готов отгружать.',
    template: '{{client}} · склад готов отгружать',
    roles: ['manager', 'sales', 'rop', 'admin'],
  },
  {
    key: 'order.shipped',
    label: 'Заказ отгружен',
    description: 'Заказ ушёл клиенту.',
    template: 'Заказ #{{id}} отправлен',
    roles: ['manager', 'sales', 'rop', 'admin'],
  },
  {
    key: 'payment.confirmed',
    label: 'Платёж подтверждён',
    description: 'Финансист одобрил платёж, сумма зачислена в кассу.',
    template: '{{amount}} зачислены в кассу',
    roles: ['manager', 'sales', 'rop', 'admin'],
  },
  {
    key: 'payment.rejected',
    label: 'Платёж отклонён',
    description: 'Финансист отклонил платёж — нужно разобраться с причиной.',
    template: 'Платёж отклонён: {{reason}}',
    roles: ['manager', 'sales', 'rop', 'admin'],
  },
  {
    key: 'lead.created',
    label: 'Новый лид',
    description: 'Заявка с сайта / внешнего источника. Нужно взять в работу.',
    template: 'Новый лид от {{source}}',
    roles: ['manager', 'sales', 'rop', 'admin'],
  },
  {
    key: 'product.markdown',
    label: 'Уценка — проставить цену',
    description: 'Создан товар-уценка из возврата, ждёт цены от админа.',
    template: 'Заказ #{{id}}: уценённые товар(ы) ждут цены в каталоге',
    roles: ['admin'],
  },
  {
    key: 'feedback.new',
    label: 'Новое обращение (бага/идея)',
    description: 'Пользователь отправил обращение через «Помощь / Баг».',
    template: '{{category}}: {{subject}}',
    roles: ['admin'],
  },
  {
    key: 'feedback.message',
    label: 'Сообщение в обсуждении обращения',
    description: 'Новая реплика в обсуждении вашего обращения или обращения юзера к админу.',
    template: '💬 Вопрос / ответ по обращению #{{id}}',
    roles: ['admin', 'manager', 'sales', 'rop', 'warehouse', 'aus', 'finance'],
  },
  {
    key: 'feedback.awaiting_approval',
    label: 'Обращение ждёт вашего подтверждения',
    description: 'Админ отметил задачу выполненной, нужно нажать «Принимаю» или вернуть в работу.',
    template: 'Подтвердите выполнение: {{subject}}',
    roles: ['admin', 'manager', 'sales', 'rop', 'warehouse', 'aus', 'finance'],
  },
  {
    key: 'feedback.rejected',
    label: 'Обращение вернули в работу',
    description: 'Автор обращения не принял выполнение, нужно посмотреть причину.',
    template: 'Обращение #{{id}} возвращено в работу',
    roles: ['admin'],
  },
];

// Видит ли пользователь с такой ролью этот тип уведомления.
export function notificationTypeRelevantForRole(typeKey, role) {
  const t = NOTIFICATION_TYPES.find((x) => x.key === typeKey);
  if (!t) return true; // неизвестный тип — пропускаем безусловно (легаси-вызов)
  return t.roles.includes(role);
}
