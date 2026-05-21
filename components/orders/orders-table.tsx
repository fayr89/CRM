"use client";

import type { Order } from "@/lib/types";
import { formatCurrency, formatDateTime, orderStatusLabels, mockCurrentUser } from "@/lib/mock-data";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Package, ArrowRight, Check, X } from "lucide-react";
import { toast } from "sonner";

interface OrdersTableProps {
  orders: Order[];
  onOrderMove: (orderId: number, newStatus: string) => void;
}

export function OrdersTable({ orders, onOrderMove }: OrdersTableProps) {
  const user = mockCurrentUser;
  const isWarehouse = user.role === 'warehouse' || user.role === 'admin';
  const isManager = user.role === 'manager' || user.role === 'admin';

  const handleAction = (order: Order, action: string) => {
    switch (action) {
      case 'reserve':
        onOrderMove(order.id, 'reserved');
        toast.success(`Заказ #${order.id} зарезервирован`);
        break;
      case 'ship':
        onOrderMove(order.id, 'shipped');
        toast.success(`Заказ #${order.id} отгружен`);
        break;
      case 'complete':
        onOrderMove(order.id, 'completed');
        toast.success(`Заказ #${order.id} завершён`);
        break;
      case 'cancel':
        const reason = window.prompt('Укажите причину отмены:');
        if (reason !== null) {
          onOrderMove(order.id, 'cancelled');
          toast.info(`Заказ #${order.id} отменён`);
        }
        break;
    }
  };

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Заказов пока нет"
        description={isWarehouse 
          ? "Заказы появятся здесь, когда поступят с площадок или будут созданы вручную."
          : "Создайте первый заказ или дождитесь поступления с площадок."
        }
      />
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#e3e6eb] overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e3e6eb] bg-[#f9fafb]">
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">№</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Площадка</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Внеш. №</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Клиент</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Сумма</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Поз.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Статус</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Менеджер</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Создан</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-[#6b7280] uppercase tracking-wide">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e3e6eb]">
            {orders.map(order => (
              <tr key={order.id} className="hover:bg-[#f9fafb] cursor-pointer transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-[#1f2328]">#{order.id}</td>
                <td className="px-4 py-3 text-sm text-[#6b7280]">{order.marketplace || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#6b7280] font-mono text-xs">{order.referenceNumber || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#1f2328]">{order.clientName || '—'}</td>
                <td className="px-4 py-3 text-sm font-medium text-[#1f2328]">{formatCurrency(order.totalAmount)}</td>
                <td className="px-4 py-3 text-sm text-[#6b7280]">{order.itemsCount || 0}</td>
                <td className="px-4 py-3">
                  <StatusBadge value={order.status} />
                </td>
                <td className="px-4 py-3 text-sm text-[#6b7280]">{order.managerName || '—'}</td>
                <td className="px-4 py-3 text-sm text-[#6b7280]">{formatDateTime(order.createdAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {/* Reserve action - warehouse/admin + new */}
                    {isWarehouse && order.status === 'new' && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); handleAction(order, 'reserve'); }}
                      >
                        <ArrowRight className="w-3 h-3 mr-1" />
                        Резерв
                      </Button>
                    )}
                    
                    {/* Ship action - warehouse/admin + reserved */}
                    {isWarehouse && order.status === 'reserved' && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); handleAction(order, 'ship'); }}
                      >
                        <ArrowRight className="w-3 h-3 mr-1" />
                        Отгрузить
                      </Button>
                    )}
                    
                    {/* Complete action - manager/admin + shipped */}
                    {isManager && order.status === 'shipped' && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="text-[#16a34a] border-[#16a34a] hover:bg-[#d1fae5]"
                        onClick={(e) => { e.stopPropagation(); handleAction(order, 'complete'); }}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        Завершить
                      </Button>
                    )}
                    
                    {/* Cancel action - any with access + not closed */}
                    {!['completed', 'cancelled'].includes(order.status) && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="text-[#dc2626] border-[#dc2626] hover:bg-[#fee2e2]"
                        onClick={(e) => { e.stopPropagation(); handleAction(order, 'cancel'); }}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Отменить
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
