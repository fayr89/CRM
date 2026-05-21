import type {
  User,
  Company,
  Contact,
  Lead,
  Deal,
  Activity,
  Product,
  Order,
  Payment,
  Notification,
  ApiToken,
  Webhook,
  Invitation,
  OrderItem,
} from './types';

// Utility: Generate avatar colors based on name
export function getAvatarColor(name: string): string {
  const colors = [
    '#2563eb', // blue
    '#7c3aed', // violet
    '#db2777', // pink
    '#dc2626', // red
    '#ea580c', // orange
    '#16a34a', // green
    '#0891b2', // cyan
    '#4f46e5', // indigo
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Users
export const mockUsers: User[] = [
  { id: 1, name: 'Администратор', email: 'admin@example.com', role: 'admin', active: true },
  { id: 2, name: 'Мария Иванова', email: 'manager@example.com', role: 'manager', active: true },
  { id: 3, name: 'Алиса Петрова', email: 'sales@example.com', role: 'sales', managerId: 2, active: true },
  { id: 4, name: 'Кирилл Сидоров', email: 'warehouse@example.com', role: 'warehouse', managerId: 2, active: true },
];

// Companies
export const mockCompanies: Company[] = [
  { id: 1, name: 'ООО «Глобал»', industry: 'Ритейл', size: 'large', annualRevenue: 50000000, ownerId: 2, createdAt: '2024-01-15' },
  { id: 2, name: 'ИП Сидоров', industry: 'Производство', size: 'small', annualRevenue: 3000000, ownerId: 3, createdAt: '2024-02-10' },
  { id: 3, name: 'ООО «ТехноПром»', industry: 'IT', size: 'medium', annualRevenue: 15000000, ownerId: 2, createdAt: '2024-03-05' },
  { id: 4, name: 'АО «МегаСтрой»', industry: 'Строительство', size: 'enterprise', annualRevenue: 200000000, ownerId: 2, createdAt: '2024-01-20' },
  { id: 5, name: 'ООО «Фуд Плюс»', industry: 'Общепит', size: 'medium', annualRevenue: 8000000, ownerId: 3, createdAt: '2024-04-01' },
];

// Contacts
export const mockContacts: Contact[] = [
  { id: 1, firstName: 'Иван', lastName: 'Петров', email: 'ivan@global.ru', phone: '+7 999 123-45-67', position: 'Директор', companyId: 1, ownerId: 2 },
  { id: 2, firstName: 'Елена', lastName: 'Смирнова', email: 'elena@global.ru', phone: '+7 999 234-56-78', position: 'Закупщик', companyId: 1, ownerId: 2 },
  { id: 3, firstName: 'Алексей', lastName: 'Сидоров', email: 'alexey@ip-sidorov.ru', phone: '+7 999 345-67-89', position: 'Владелец', companyId: 2, ownerId: 3 },
  { id: 4, firstName: 'Ольга', lastName: 'Козлова', email: 'olga@technoprom.ru', phone: '+7 999 456-78-90', position: 'HR-директор', companyId: 3, ownerId: 2 },
  { id: 5, firstName: 'Дмитрий', lastName: 'Николаев', email: 'dmitry@megastroy.ru', phone: '+7 999 567-89-01', position: 'Финансовый директор', companyId: 4, ownerId: 2 },
  { id: 6, firstName: 'Анна', lastName: 'Волкова', email: 'anna@megastroy.ru', phone: '+7 999 678-90-12', position: 'Менеджер проектов', companyId: 4, ownerId: 3 },
  { id: 7, firstName: 'Сергей', lastName: 'Морозов', email: 'sergey@foodplus.ru', phone: '+7 999 789-01-23', position: 'Директор', companyId: 5, ownerId: 3 },
  { id: 8, firstName: 'Наталья', lastName: 'Лебедева', email: 'natalia@foodplus.ru', phone: '+7 999 890-12-34', position: 'Бухгалтер', companyId: 5, ownerId: 2 },
];

// Leads
export const mockLeads: Lead[] = [
  { id: 1, firstName: 'Виктор', lastName: 'Кузнецов', email: 'victor@mail.ru', phone: '+7 999 111-22-33', companyName: 'Новая Компания', source: 'website', status: 'new', estimatedValue: 150000, ownerId: 3 },
  { id: 2, firstName: 'Марина', lastName: 'Попова', email: 'marina@yandex.ru', phone: '+7 999 222-33-44', companyName: 'СтартАп Инк', source: 'referral', status: 'contacted', estimatedValue: 300000, ownerId: 2 },
  { id: 3, firstName: 'Павел', lastName: 'Соколов', email: 'pavel@gmail.com', phone: '+7 999 333-44-55', companyName: 'ИП Соколов', source: 'cold_call', status: 'qualified', estimatedValue: 80000, ownerId: 3 },
  { id: 4, firstName: 'Татьяна', lastName: 'Новикова', email: 'tatiana@outlook.com', phone: '+7 999 444-55-66', companyName: 'Сеть магазинов', source: 'social', status: 'unqualified', estimatedValue: 50000, ownerId: 2 },
  { id: 5, firstName: 'Андрей', lastName: 'Орлов', email: 'andrey@corp.ru', phone: '+7 999 555-66-77', companyName: 'ООО Орёл', source: 'event', status: 'converted', estimatedValue: 500000, ownerId: 3 },
  { id: 6, firstName: 'Юлия', lastName: 'Федорова', email: 'julia@example.com', phone: '+7 999 666-77-88', companyName: 'Студия Дизайна', source: 'advertisement', status: 'new', estimatedValue: 120000, ownerId: 2 },
];

// Deals
export const mockDeals: Deal[] = [
  { id: 1, title: 'Поставка офисной мебели', amount: 450000, currency: 'RUB', stage: 'new', probability: 10, expectedCloseDate: '2024-06-15', companyId: 1, companyName: 'ООО «Глобал»', contactId: 1, ownerId: 2 },
  { id: 2, title: 'IT-оборудование', amount: 1200000, currency: 'RUB', stage: 'qualified', probability: 30, expectedCloseDate: '2024-06-20', companyId: 3, companyName: 'ООО «ТехноПром»', contactId: 4, ownerId: 2 },
  { id: 3, title: 'Канцелярские товары', amount: 85000, currency: 'RUB', stage: 'proposal', probability: 50, expectedCloseDate: '2024-05-30', companyId: 2, companyName: 'ИП Сидоров', contactId: 3, ownerId: 3 },
  { id: 4, title: 'Строительные материалы', amount: 3500000, currency: 'RUB', stage: 'negotiation', probability: 70, expectedCloseDate: '2024-07-10', companyId: 4, companyName: 'АО «МегаСтрой»', contactId: 5, ownerId: 2 },
  { id: 5, title: 'Упаковочные материалы', amount: 120000, currency: 'RUB', stage: 'won', probability: 100, expectedCloseDate: '2024-05-01', companyId: 5, companyName: 'ООО «Фуд Плюс»', contactId: 7, ownerId: 3 },
  { id: 6, title: 'Продукты питания оптом', amount: 280000, currency: 'RUB', stage: 'won', probability: 100, expectedCloseDate: '2024-04-25', companyId: 5, companyName: 'ООО «Фуд Плюс»', contactId: 7, ownerId: 2 },
  { id: 7, title: 'Офисная техника', amount: 95000, currency: 'RUB', stage: 'lost', probability: 0, expectedCloseDate: '2024-05-10', companyId: 1, companyName: 'ООО «Глобал»', contactId: 2, ownerId: 3 },
  { id: 8, title: 'Ремонт офиса', amount: 750000, currency: 'RUB', stage: 'new', probability: 10, expectedCloseDate: '2024-08-01', companyId: 3, companyName: 'ООО «ТехноПром»', contactId: 4, ownerId: 2 },
  { id: 9, title: 'Логистические услуги', amount: 180000, currency: 'RUB', stage: 'qualified', probability: 30, expectedCloseDate: '2024-06-25', companyId: 4, companyName: 'АО «МегаСтрой»', contactId: 6, ownerId: 3 },
  { id: 10, title: 'Консалтинг', amount: 320000, currency: 'RUB', stage: 'proposal', probability: 50, expectedCloseDate: '2024-07-05', companyId: 1, companyName: 'ООО «Глобал»', contactId: 1, ownerId: 2 },
];

// Activities
export const mockActivities: Activity[] = [
  { id: 1, type: 'call', subject: 'Звонок по заказу #1001', dueDate: '2024-05-18', relatedToType: 'company', relatedToId: 1, ownerId: 2 },
  { id: 2, type: 'meeting', subject: 'Встреча с директором', dueDate: '2024-05-20', relatedToType: 'contact', relatedToId: 1, ownerId: 2 },
  { id: 3, type: 'email', subject: 'Отправить КП', dueDate: '2024-05-15', completedAt: '2024-05-15', relatedToType: 'deal', relatedToId: 3, ownerId: 3 },
  { id: 4, type: 'task', subject: 'Подготовить договор', dueDate: '2024-05-10', relatedToType: 'deal', relatedToId: 4, ownerId: 2 }, // overdue
  { id: 5, type: 'call', subject: 'Уточнить детали доставки', dueDate: '2024-05-12', relatedToType: 'company', relatedToId: 4, ownerId: 3 }, // overdue
  { id: 6, type: 'meeting', subject: 'Презентация продукта', dueDate: '2024-05-25', relatedToType: 'lead', relatedToId: 2, ownerId: 2 },
  { id: 7, type: 'email', subject: 'Напоминание об оплате', dueDate: '2024-05-08', relatedToType: 'company', relatedToId: 2, ownerId: 3 }, // overdue
  { id: 8, type: 'task', subject: 'Обновить CRM', dueDate: '2024-05-22', relatedToType: 'company', relatedToId: 3, ownerId: 2 },
  { id: 9, type: 'call', subject: 'Обсудить скидки', dueDate: '2024-05-28', relatedToType: 'deal', relatedToId: 10, ownerId: 2 },
  { id: 10, type: 'meeting', subject: 'Финальные переговоры', dueDate: '2024-06-01', relatedToType: 'deal', relatedToId: 4, ownerId: 2 },
  { id: 11, type: 'task', subject: 'Проверить склад', dueDate: '2024-05-19', relatedToType: 'company', relatedToId: 5, ownerId: 4 },
  { id: 12, type: 'email', subject: 'Запросить реквизиты', dueDate: '2024-05-21', relatedToType: 'lead', relatedToId: 1, ownerId: 3 },
];

// Products with real Unsplash images
export const mockProducts: Product[] = [
  { id: 1, sku: 'TSH-001', name: 'Футболка базовая белая', imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop', costPrice: 350, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 890 }, { marketplace: 'Ozon', price: 920 }], priceCount: 2, recentUsage: 42 },
  { id: 2, sku: 'TSH-002', name: 'Футболка базовая чёрная', imageUrl: 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=200&h=200&fit=crop', costPrice: 350, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 890 }, { marketplace: 'Ozon', price: 920 }, { marketplace: 'Avito', price: 800 }], priceCount: 3, recentUsage: 38 },
  { id: 3, sku: 'JNS-001', name: 'Джинсы классические синие', imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=200&h=200&fit=crop', costPrice: 1200, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 2990 }, { marketplace: 'Яндекс.Маркет', price: 3100 }], priceCount: 2, recentUsage: 25 },
  { id: 4, sku: 'MUG-001', name: 'Кружка керамическая 350мл', imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=200&h=200&fit=crop', costPrice: 180, unit: 'шт', active: true, prices: [{ marketplace: 'Ozon', price: 450 }, { marketplace: 'Avito', price: 400 }], priceCount: 2, recentUsage: 31 },
  { id: 5, sku: 'PLT-001', name: 'Тарелка обеденная 26см', imageUrl: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=200&h=200&fit=crop', costPrice: 250, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 590 }], priceCount: 1, recentUsage: 18 },
  { id: 6, sku: 'HDR-001', name: 'Наушники беспроводные', imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&h=200&fit=crop', costPrice: 2500, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 4990 }, { marketplace: 'Ozon', price: 5100 }, { marketplace: 'Яндекс.Маркет', price: 4890 }], priceCount: 3, recentUsage: 56 },
  { id: 7, sku: 'CHG-001', name: 'Зарядное устройство USB-C', imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=200&h=200&fit=crop', costPrice: 450, unit: 'шт', active: true, prices: [{ marketplace: 'Ozon', price: 990 }, { marketplace: 'Avito', price: 850 }], priceCount: 2, recentUsage: 47 },
  { id: 8, sku: 'FLT-001', name: 'Масляный фильтр авто', imageUrl: 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=200&h=200&fit=crop', costPrice: 320, unit: 'шт', active: true, prices: [{ marketplace: 'Avito', price: 650 }], priceCount: 1, recentUsage: 12 },
  { id: 9, sku: 'BRK-001', name: 'Тормозные колодки', imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&h=200&fit=crop', costPrice: 1800, unit: 'комп', active: true, prices: [{ marketplace: 'Avito', price: 3200 }, { marketplace: 'Другое', price: 3500 }], priceCount: 2, recentUsage: 8 },
  { id: 10, sku: 'BAG-001', name: 'Рюкзак городской', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=200&h=200&fit=crop', costPrice: 950, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 2290 }, { marketplace: 'Ozon', price: 2350 }], priceCount: 2, recentUsage: 29 },
  { id: 11, sku: 'CAP-001', name: 'Кепка с козырьком', imageUrl: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=200&h=200&fit=crop', costPrice: 280, unit: 'шт', active: true, prices: [{ marketplace: 'Wildberries', price: 690 }], priceCount: 1, recentUsage: 15 },
  { id: 12, sku: 'WCH-001', name: 'Часы наручные кварцевые', imageUrl: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=200&h=200&fit=crop', costPrice: 1500, unit: 'шт', active: true, prices: [{ marketplace: 'Ozon', price: 3490 }, { marketplace: 'Яндекс.Маркет', price: 3600 }], priceCount: 2, recentUsage: 21 },
  { id: 13, sku: 'SHO-001', name: 'Кроссовки спортивные', imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&h=200&fit=crop', costPrice: 2200, unit: 'пара', active: true, prices: [{ marketplace: 'Wildberries', price: 4990 }, { marketplace: 'Ozon', price: 5200 }], priceCount: 2, recentUsage: 33 },
  { id: 14, sku: 'LAM-001', name: 'Настольная лампа LED', imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', costPrice: 780, unit: 'шт', active: true, prices: [{ marketplace: 'Ozon', price: 1690 }], priceCount: 1, recentUsage: 14 },
  { id: 15, sku: 'OLD-001', name: 'Товар в архиве', imageUrl: null, costPrice: 100, unit: 'шт', active: false, prices: [], priceCount: 0, recentUsage: 0 },
];

// Orders
export const mockOrders: Order[] = [
  { id: 1001, referenceNumber: 'WB-78901234', marketplace: 'Wildberries', clientClassification: 'B2C', clientName: 'Петрова А.С.', totalAmount: 4780, currency: 'RUB', status: 'new', managerId: 2, managerName: 'Мария Иванова', createdAt: '2024-05-18T10:30:00', itemsCount: 3, previewImage: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop', items: [{ id: 1, sku: 'TSH-001', name: 'Футболка базовая белая', quantity: 2, unitPrice: 890, lineTotal: 1780, productId: 1, imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop', catalogPrice: 890 }, { id: 2, sku: 'JNS-001', name: 'Джинсы классические синие', quantity: 1, unitPrice: 3000, lineTotal: 3000, productId: 3, imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=200&h=200&fit=crop', catalogPrice: 2990 }] },
  { id: 1002, referenceNumber: 'OZ-45678901', marketplace: 'Ozon', clientClassification: 'B2C', clientName: 'Иванов К.П.', totalAmount: 5100, currency: 'RUB', status: 'new', managerId: 2, managerName: 'Мария Иванова', createdAt: '2024-05-17T14:22:00', itemsCount: 1, previewImage: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&h=200&fit=crop' },
  { id: 1003, referenceNumber: 'AV-12345', marketplace: 'Avito', clientClassification: 'B2B', clientName: 'ООО «Ромашка»', totalAmount: 12500, currency: 'RUB', status: 'new', managerId: 3, managerName: 'Алиса Петрова', createdAt: '2024-05-16T09:15:00', itemsCount: 5, previewImage: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=200&h=200&fit=crop' },
  { id: 1004, referenceNumber: 'YM-99887766', marketplace: 'Яндекс.Маркет', clientClassification: 'B2C', clientName: 'Сидорова М.В.', totalAmount: 3490, currency: 'RUB', status: 'reserved', managerId: 2, managerName: 'Мария Иванова', warehouseUserName: 'Кирилл Сидоров', reservedAt: '2024-05-15T11:00:00', createdAt: '2024-05-14T16:45:00', itemsCount: 1, previewImage: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=200&h=200&fit=crop' },
  { id: 1005, referenceNumber: 'WB-55443322', marketplace: 'Wildberries', clientClassification: 'VIP', clientName: 'Козлов Д.А.', totalAmount: 9980, currency: 'RUB', status: 'reserved', managerId: 3, managerName: 'Алиса Петрова', warehouseUserName: 'Кирилл Сидоров', reservedAt: '2024-05-16T10:30:00', createdAt: '2024-05-15T12:00:00', itemsCount: 2, previewImage: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&h=200&fit=crop' },
  { id: 1006, referenceNumber: 'OZ-11223344', marketplace: 'Ozon', clientClassification: 'B2C', clientName: 'Новиков А.А.', totalAmount: 1690, currency: 'RUB', status: 'shipped', managerId: 2, managerName: 'Мария Иванова', warehouseUserName: 'Кирилл Сидоров', reservedAt: '2024-05-10T09:00:00', shippedAt: '2024-05-12T14:30:00', createdAt: '2024-05-09T11:20:00', itemsCount: 1, previewImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' },
  { id: 1007, marketplace: 'Другое', clientClassification: 'B2B', clientName: 'ИП Белов', totalAmount: 6400, currency: 'RUB', status: 'completed', managerId: 3, managerName: 'Алиса Петрова', warehouseUserName: 'Кирилл Сидоров', reservedAt: '2024-05-05T10:00:00', shippedAt: '2024-05-07T15:00:00', completedAt: '2024-05-10T09:30:00', createdAt: '2024-05-04T14:10:00', itemsCount: 4, previewImage: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&h=200&fit=crop' },
  { id: 1008, referenceNumber: 'AV-99999', marketplace: 'Avito', clientClassification: 'B2C', clientName: 'Морозова Е.П.', totalAmount: 2290, currency: 'RUB', status: 'cancelled', managerId: 2, managerName: 'Мария Иванова', cancelledAt: '2024-05-13T16:00:00', cancelReason: 'Клиент передумал', createdAt: '2024-05-12T10:45:00', itemsCount: 1, previewImage: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=200&h=200&fit=crop' },
];

// Payments
export const mockPayments: Payment[] = [
  { id: 1, managerId: 2, managerName: 'Мария Иванова', orderId: 1007, amount: 6400, currency: 'RUB', method: 'bank_transfer', reference: 'PAY-001', status: 'confirmed', confirmedAt: '2024-05-11T10:00:00', confirmedBy: 1, createdAt: '2024-05-10T15:30:00' },
  { id: 2, managerId: 3, managerName: 'Алиса Петрова', amount: 15000, currency: 'RUB', method: 'cash', status: 'confirmed', confirmedAt: '2024-05-12T11:00:00', confirmedBy: 1, createdAt: '2024-05-12T09:00:00' },
  { id: 3, managerId: 2, managerName: 'Мария Иванова', orderId: 1004, amount: 3490, currency: 'RUB', method: 'card', reference: 'PAY-003', status: 'confirmed', confirmedAt: '2024-05-15T14:00:00', confirmedBy: 1, createdAt: '2024-05-15T12:30:00' },
  { id: 4, managerId: 2, managerName: 'Мария Иванова', amount: 5000, currency: 'RUB', method: 'cash', status: 'pending', createdAt: '2024-05-17T16:00:00' },
  { id: 5, managerId: 3, managerName: 'Алиса Петрова', amount: 1350, currency: 'RUB', method: 'card', reference: 'PAY-005', status: 'pending', createdAt: '2024-05-18T09:30:00' },
  { id: 6, managerId: 3, managerName: 'Алиса Петрова', amount: 2500, currency: 'RUB', method: 'bank_transfer', reference: 'PAY-006', status: 'rejected', rejectionReason: 'Неверные реквизиты', createdAt: '2024-05-14T11:00:00' },
];

// Notifications
export const mockNotifications: Notification[] = [
  { id: 1, type: 'order', title: 'Новый заказ #1001', body: 'Поступил заказ на 4 780 ₽ от Петрова А.С.', link: '/orders', createdAt: '2024-05-18T10:30:00' },
  { id: 2, type: 'order', title: 'Новый заказ #1002', body: 'Поступил заказ на 5 100 ₽ от Иванов К.П.', link: '/orders', createdAt: '2024-05-17T14:22:00' },
  { id: 3, type: 'payment', title: 'Платёж на подтверждении', body: 'Мария Иванова добавила платёж на 5 000 ₽', link: '/cashbox', createdAt: '2024-05-17T16:00:00' },
  { id: 4, type: 'deal', title: 'Сделка выиграна!', body: '«Упаковочные материалы» на 120 000 ₽ закрыта', link: '/pipeline', readAt: '2024-05-17T10:00:00', createdAt: '2024-05-16T18:00:00' },
  { id: 5, type: 'activity', title: 'Просроченная задача', body: '«Подготовить договор» просрочена на 8 дней', link: '/activities', createdAt: '2024-05-18T08:00:00' },
  { id: 6, type: 'lead', title: 'Новый лид', body: 'Юлия Федорова из «Студия Дизайна»', link: '/leads', createdAt: '2024-05-17T11:00:00' },
  { id: 7, type: 'order', title: 'Заказ отгружен', body: '#1006 отправлен клиенту', link: '/orders', readAt: '2024-05-12T15:00:00', createdAt: '2024-05-12T14:35:00' },
  { id: 8, type: 'order', title: 'Заказ завершён', body: '#1007 успешно завершён', link: '/orders', readAt: '2024-05-10T10:00:00', createdAt: '2024-05-10T09:35:00' },
  { id: 9, type: 'payment', title: 'Платёж подтверждён', body: 'Платёж на 3 490 ₽ подтверждён', link: '/cashbox', readAt: '2024-05-15T14:30:00', createdAt: '2024-05-15T14:05:00' },
  { id: 10, type: 'activity', title: 'Напоминание о встрече', body: '«Встреча с директором» через 2 дня', link: '/activities', createdAt: '2024-05-18T07:00:00' },
  { id: 11, type: 'order', title: 'Заказ отменён', body: '#1008 отменён клиентом', link: '/orders', readAt: '2024-05-13T16:30:00', createdAt: '2024-05-13T16:05:00' },
  { id: 12, type: 'system', title: 'Добро пожаловать!', body: 'Начните с раздела «Дашборд»', link: '/dashboard', readAt: '2024-05-01T10:00:00', createdAt: '2024-05-01T09:00:00' },
];

// API Tokens
export const mockApiTokens: ApiToken[] = [
  { id: 1, name: 'Лендинг promo.example.com', tokenPrefix: 'crm_abc...xyz', scopes: 'leads:create', lastUsedAt: '2024-05-18T09:15:00', createdAt: '2024-04-01T12:00:00' },
  { id: 2, name: 'Telegram-бот', tokenPrefix: 'crm_def...uvw', scopes: 'leads:create, orders:create', lastUsedAt: '2024-05-17T22:30:00', createdAt: '2024-04-15T10:00:00' },
];

// Webhooks
export const mockWebhooks: Webhook[] = [
  { id: 1, name: 'Уведомления в Telegram', url: 'https://api.telegram.org/bot.../sendMessage', events: 'order.created, order.shipped', active: true, deliveriesCount: 156, lastDeliveryAt: '2024-05-18T10:30:05', lastStatusCode: 200 },
];

// Invitations
export const mockInvitations: Invitation[] = [
  { id: 1, email: 'newuser@example.com', role: 'sales', invitedBy: 2, invitedByName: 'Мария Иванова', expiresAt: '2024-05-25T12:00:00', createdAt: '2024-05-18T12:00:00' },
  { id: 2, email: 'another@example.com', role: 'warehouse', invitedBy: 1, invitedByName: 'Администратор', expiresAt: '2024-05-20T10:00:00', acceptedAt: '2024-05-19T09:00:00', createdAt: '2024-05-13T10:00:00' },
];

// Current user (for mock purposes)
export const mockCurrentUser: User = mockUsers[1]; // Мария Иванова (manager)

// Helper functions
export function formatCurrency(amount: number, currency: string = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString));
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString));
}

export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'только что';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ч. назад`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} дн. назад`;
  return formatDate(dateString);
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

// Stage and status labels
export const stageLabels: Record<string, string> = {
  new: 'Новая',
  qualified: 'Квалифицирована',
  proposal: 'Предложение',
  negotiation: 'Переговоры',
  won: 'Выиграна',
  lost: 'Проиграна',
};

export const leadStatusLabels: Record<string, string> = {
  new: 'Новый',
  contacted: 'Контакт',
  qualified: 'Квалифицирован',
  unqualified: 'Не квалифицирован',
  converted: 'Конвертирован',
};

export const orderStatusLabels: Record<string, string> = {
  new: 'Новый',
  reserved: 'Зарезервирован',
  shipped: 'Отгружен',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export const paymentStatusLabels: Record<string, string> = {
  pending: 'На подтверждении',
  confirmed: 'Подтверждён',
  rejected: 'Отклонён',
};

export const paymentMethodLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  bank_transfer: 'Банк. перевод',
  other: 'Другое',
};

export const activityTypeLabels: Record<string, string> = {
  call: 'Звонок',
  email: 'Email',
  meeting: 'Встреча',
  task: 'Задача',
};

export const sourceLabels: Record<string, string> = {
  website: 'Сайт',
  referral: 'Рекомендация',
  cold_call: 'Холодный звонок',
  social: 'Соц. сети',
  event: 'Мероприятие',
  advertisement: 'Реклама',
  other: 'Другое',
};

export const roleLabels: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  sales: 'Продажник',
  warehouse: 'Склад',
};

export const sizeLabels: Record<string, string> = {
  small: 'Малый',
  medium: 'Средний',
  large: 'Крупный',
  enterprise: 'Корпорация',
};

// --- Расписание отгрузок и аналитика ---

import type {
  ShippingSchedule,
  AnalyticsRevenuePoint,
  AnalyticsManager,
  AnalyticsMarketplace,
  AnalyticsProductTop,
  Weekday,
} from './types';

export const mockSchedule: ShippingSchedule = {
  days: ['mon', 'wed', 'fri'],
  cutoffTime: '14:00',
  notes: 'Кейс с Wildberries проходит до полудня',
};

export const weekdayLabels: Record<Weekday, string> = {
  mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс',
};

// Возвращает дату ближайшего отгрузочного дня (или null).
export function nextShippingDate(
  days: Weekday[],
  cutoff: string,
  now = new Date(),
): Date | null {
  if (days.length === 0) return null;
  const dayMap: Record<Weekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const allowed = new Set(days.map((d) => dayMap[d]));
  const [h, m] = cutoff.split(':').map(Number);
  const result = new Date(now);
  result.setHours(h, m, 0, 0);
  if (allowed.has(now.getDay()) && now.getTime() < result.getTime()) return result;
  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    candidate.setHours(h, m, 0, 0);
    if (allowed.has(candidate.getDay())) return candidate;
  }
  return null;
}

// Mock — выручка за 30 дней (синусоида + случайный шум для красоты)
function generateRevenueTrend(days: number): AnalyticsRevenuePoint[] {
  const out: AnalyticsRevenuePoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    // выходные обычно ниже
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const base = isWeekend ? 8000 : 18000;
    const variance = Math.random() * 12000 - 4000;
    const revenue = Math.max(0, Math.round(base + variance + i * 200));
    out.push({
      date: d.toISOString().slice(0, 10),
      ordersCount: Math.max(1, Math.round(revenue / 5500)),
      revenue,
    });
  }
  return out;
}

export const mockAnalyticsRevenue = generateRevenueTrend(30);

export const mockAnalyticsManagers: AnalyticsManager[] = [
  { id: 2, name: 'Мария Иванова', role: 'manager', revenue: 487000, ordersCount: 89, dealsWon: 12, dealsRevenue: 2840000 },
  { id: 3, name: 'Алиса Петрова', role: 'sales', revenue: 312000, ordersCount: 54, dealsWon: 7, dealsRevenue: 1200000 },
  { id: 1, name: 'Администратор', role: 'admin', revenue: 96000, ordersCount: 18, dealsWon: 2, dealsRevenue: 320000 },
];

export const mockAnalyticsMarketplaces: AnalyticsMarketplace[] = [
  { marketplace: 'Wildberries', ordersCount: 87, revenue: 425000, avgOrderValue: 4885 },
  { marketplace: 'Ozon', ordersCount: 54, revenue: 268000, avgOrderValue: 4963 },
  { marketplace: 'Avito', ordersCount: 28, revenue: 142000, avgOrderValue: 5071 },
  { marketplace: 'Яндекс.Маркет', ordersCount: 21, revenue: 96500, avgOrderValue: 4595 },
  { marketplace: 'Другое', ordersCount: 8, revenue: 24500, avgOrderValue: 3063 },
];

export const mockAnalyticsTopProducts: AnalyticsProductTop[] = [
  { id: 6, sku: 'HDR-001', name: 'Наушники беспроводные', imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&h=200&fit=crop', costPrice: 2500, unitsSold: 56, revenue: 279440, profit: 139440 },
  { id: 1, sku: 'TSH-001', name: 'Футболка базовая белая', imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop', costPrice: 350, unitsSold: 42, revenue: 37380, profit: 22680 },
  { id: 7, sku: 'CHG-001', name: 'Зарядное устройство USB-C', imageUrl: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=200&h=200&fit=crop', costPrice: 450, unitsSold: 47, revenue: 46530, profit: 25380 },
  { id: 2, sku: 'TSH-002', name: 'Футболка базовая чёрная', imageUrl: 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=200&h=200&fit=crop', costPrice: 350, unitsSold: 38, revenue: 33820, profit: 20520 },
  { id: 13, sku: 'SHO-001', name: 'Кроссовки спортивные', imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200&h=200&fit=crop', costPrice: 2200, unitsSold: 33, revenue: 164670, profit: 91410 },
];

export const mockAnalyticsSummary = {
  revenue: { total: 956000, completedOrders: 198, avgOrderValue: 4828 },
  orders: { newOrders: 12, reservedOrders: 8, shippedOrders: 5 },
  deals: { won: 21, lost: 7, wonAmount: 4360000, open: 18, winRate: 0.75 },
  customers: { newLeads: 34, newContacts: 22, newCompanies: 9 },
};
