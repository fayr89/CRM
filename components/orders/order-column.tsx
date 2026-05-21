"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/types";
import { OrderCard } from "./order-card";

interface OrderColumnProps {
  id: string;
  title: string;
  count: number;
  orders: Order[];
  isActive: boolean;
}

export function OrderColumn({ id, title, count, orders, isActive }: OrderColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-[280px] lg:w-auto lg:flex-1 min-w-[220px] snap-center",
        "bg-[#f1f3f5] rounded-lg p-3 min-h-[200px]",
        "transition-all duration-200",
        isOver && "ring-2 ring-dashed ring-[#2563eb] bg-[#e0f2fe]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#6b7280]">
          {title}
        </h3>
        <span className="text-xs text-[#6b7280] font-medium">
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {orders.map(order => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>

      {/* Empty state */}
      {orders.length === 0 && (
        <div className={cn(
          "flex items-center justify-center h-20 text-sm text-[#9ca3af]",
          isActive && "border-2 border-dashed border-[#2563eb] rounded-md"
        )}>
          {isActive ? "Отпустите здесь" : "Нет заказов"}
        </div>
      )}
    </div>
  );
}
