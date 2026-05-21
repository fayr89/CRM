"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/types";
import { formatCurrency } from "@/lib/mock-data";
import { Package, User } from "lucide-react";
import Image from "next/image";

interface OrderCardProps {
  order: Order;
  isDragging?: boolean;
}

export function OrderCard({ order, isDragging }: OrderCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: order.id,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "bg-white border border-[#e3e6eb] rounded-md p-3 cursor-grab active:cursor-grabbing",
        "hover:border-[#2563eb] transition-colors",
        isDragging && "opacity-40 scale-[0.97] shadow-lg"
      )}
    >
      {/* Top row: image + ID + client */}
      <div className="flex items-center gap-2 mb-2">
        {order.previewImage ? (
          <Image
            src={order.previewImage}
            alt=""
            width={36}
            height={36}
            className="w-9 h-9 rounded object-cover"
          />
        ) : (
          <div className="w-9 h-9 rounded bg-[#f3f4f6] flex items-center justify-center">
            <Package className="w-4 h-4 text-[#9ca3af]" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1f2328] truncate">
            #{order.id} · {order.clientName || 'Клиент'}
          </p>
        </div>
      </div>

      {/* Amount + marketplace */}
      <p className="text-xs text-[#6b7280]">
        {formatCurrency(order.totalAmount)} · {order.marketplace || 'Другое'}
      </p>

      {/* Reference number */}
      {order.referenceNumber && (
        <p className="text-xs text-[#9ca3af] mt-1 font-mono">
          № {order.referenceNumber}
        </p>
      )}

      {/* Manager */}
      {order.managerName && (
        <p className="text-xs text-[#9ca3af] mt-1 flex items-center gap-1">
          <User className="w-3 h-3" />
          {order.managerName}
        </p>
      )}
    </div>
  );
}
