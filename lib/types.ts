export type Role = 'admin' | 'manager' | 'sales' | 'warehouse';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  managerId?: number | null;
  active: boolean;
}

export interface Company {
  id: number;
  name: string;
  industry?: string;
  size?: 'small' | 'medium' | 'large' | 'enterprise';
  annualRevenue?: number;
  ownerId?: number;
  createdAt: string;
}

export interface Contact {
  id: number;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  companyId?: number;
  ownerId?: number;
}

export interface Lead {
  id: number;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source: 'website' | 'referral' | 'cold_call' | 'social' | 'event' | 'advertisement' | 'other';
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';
  estimatedValue?: number;
  ownerId?: number;
}

export interface Deal {
  id: number;
  title: string;
  amount: number;
  currency: string;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  probability: number;
  expectedCloseDate?: string;
  companyId?: number;
  companyName?: string;
  contactId?: number;
  ownerId?: number;
}

export interface Activity {
  id: number;
  type: 'call' | 'email' | 'meeting' | 'task';
  subject: string;
  dueDate?: string;
  completedAt?: string;
  relatedToType?: 'contact' | 'company' | 'lead' | 'deal';
  relatedToId?: number;
  ownerId?: number;
}

export interface Product {
  id: number;
  sku?: string;
  name: string;
  imageUrl?: string;
  costPrice: number;
  unit: string;
  description?: string;
  externalSource?: 'moysklad';
  active: boolean;
  prices?: { marketplace: string; price: number }[];
  priceCount?: number;
  marketplacePrice?: number | null;
  recentUsage?: number;
}

export type Marketplace = 'Wildberries' | 'Ozon' | 'Яндекс.Маркет' | 'Avito' | 'Другое';

export interface OrderItem {
  id: number;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productId?: number;
  imageUrl?: string;
  catalogPrice?: number | null;
}

export interface Order {
  id: number;
  referenceNumber?: string;
  marketplace?: Marketplace;
  clientClassification?: string;
  clientName?: string;
  totalAmount: number;
  currency: string;
  status: 'new' | 'reserved' | 'shipped' | 'completed' | 'cancelled';
  managerId?: number;
  managerName?: string;
  warehouseUserName?: string;
  notes?: string;
  reservedAt?: string;
  shippedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  items?: OrderItem[];
  itemsCount?: number;
  previewImage?: string | null;
}

export interface Payment {
  id: number;
  managerId: number;
  managerName?: string;
  orderId?: number;
  amount: number;
  currency: string;
  method?: 'cash' | 'card' | 'bank_transfer' | 'other';
  reference?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  confirmedAt?: string;
  confirmedBy?: number;
  rejectionReason?: string;
  createdAt: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

export interface ApiToken {
  id: number;
  name: string;
  tokenPrefix: string;
  scopes: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string;
  active: boolean;
  deliveriesCount: number;
  lastDeliveryAt?: string;
  lastStatusCode?: number;
}

export interface Invitation {
  id: number;
  email: string;
  role: Role;
  invitedBy: number;
  invitedByName?: string;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
}
