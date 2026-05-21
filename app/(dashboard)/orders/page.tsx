"use client";

import { useState, useEffect } from "react";
import { mockOrders, mockCurrentUser, formatCurrency, formatDateTime, orderStatusLabels } from "@/lib/mock-data";
import type { Order } from "@/lib/types";
import { PageHeader } from "@/components/common/page-header";
import { HelpBanner } from "@/components/common/help-banner";
import { OrdersTable } from "@/components/orders/orders-table";
import { OrdersKanban } from "@/components/orders/orders-kanban";
import { OrderFormModal } from "@/components/orders/order-form-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, List, LayoutGrid, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = 'list' | 'kanban';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [view, setView] = useState<ViewMode>('list');
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>("all");
  const [showHelp, setShowHelp] = useState(true);
  const [showOrderForm, setShowOrderForm] = useState(false);

  const user = mockCurrentUser;
  const isWarehouse = user.role === 'warehouse' || user.role === 'admin';

  // Load view preference from localStorage
  useEffect(() => {
    const savedView = localStorage.getItem('orders_view');
    if (savedView === 'kanban' || savedView === 'list') {
      setView(savedView);
    }
  }, []);

  const handleViewChange = (newView: ViewMode) => {
    setView(newView);
    localStorage.setItem('orders_view', newView);
  };

  const handleOrderMove = (orderId: number, newStatus: string) => {
    setOrders(prev =>
      prev.map(order =>
        order.id === orderId
          ? { ...order, status: newStatus as Order['status'] }
          : order
      )
    );
  };

  // Filter orders
  const filteredOrders = orders.filter(order => {
    const matchesSearch = !search || 
      order.clientName?.toLowerCase().includes(search.toLowerCase()) ||
      order.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
      String(order.id).includes(search);
    
    const matchesStatus = statusFilter === "all" || order.status === statusFilter;
    const matchesMarketplace = marketplaceFilter === "all" || order.marketplace === marketplaceFilter;
    
    return matchesSearch && matchesStatus && matchesMarketplace;
  });

  const getHelpText = () => {
    if (view === 'kanban') {
      if (isWarehouse) {
        return 'Перетаскивайте заказы: «Новый» → «Зарезервирован» → «Отгружен». Клик откроет детали.';
      }
      return 'Перетащите отгруженный заказ в «Завершён», чтобы закрыть. Менеджер может отменить новый заказ.';
    }
    return null;
  };

  const helpText = getHelpText();

  return (
    <div className="space-y-4">
      <PageHeader 
        title="Прямые продажи"
        subtitle="Заказы из маркетплейсов и с собственных сайтов"
      />

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b7280]" />
          <Input
            placeholder="Поиск по ID, клиенту, номеру..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(orderStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Площадка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все площадки</SelectItem>
            <SelectItem value="Wildberries">Wildberries</SelectItem>
            <SelectItem value="Ozon">Ozon</SelectItem>
            <SelectItem value="Яндекс.Маркет">Яндекс.Маркет</SelectItem>
            <SelectItem value="Avito">Avito</SelectItem>
            <SelectItem value="Другое">Другое</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* View Toggle */}
        <div className="flex rounded-md border border-[#e3e6eb] overflow-hidden">
          <button
            onClick={() => handleViewChange('list')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm transition-colors",
              view === 'list' 
                ? "bg-[#2563eb] text-white" 
                : "bg-white text-[#6b7280] hover:bg-[#f3f4f6]"
            )}
          >
            <List className="w-4 h-4" />
            Список
          </button>
          <button
            onClick={() => handleViewChange('kanban')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm transition-colors",
              view === 'kanban' 
                ? "bg-[#2563eb] text-white" 
                : "bg-white text-[#6b7280] hover:bg-[#f3f4f6]"
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            Канбан
          </button>
        </div>

        <Button onClick={() => setShowOrderForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Новый заказ
        </Button>
      </div>

      {/* Help Banner for Kanban */}
      {view === 'kanban' && helpText && showHelp && (
        <HelpBanner onDismiss={() => setShowHelp(false)}>
          {helpText}
        </HelpBanner>
      )}

      {/* Content */}
      {view === 'list' ? (
        <OrdersTable orders={filteredOrders} onOrderMove={handleOrderMove} />
      ) : (
        <OrdersKanban orders={filteredOrders} onOrderMove={handleOrderMove} />
      )}

      {/* Order Form Modal */}
      <OrderFormModal 
        open={showOrderForm} 
        onOpenChange={setShowOrderForm}
        onSave={(order) => {
          setOrders(prev => [...prev, { ...order, id: Math.max(...prev.map(o => o.id)) + 1 }]);
          setShowOrderForm(false);
        }}
      />
    </div>
  );
}
