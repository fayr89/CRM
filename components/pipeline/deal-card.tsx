"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/mock-data";
import { Calendar } from "lucide-react";

interface DealCardProps {
  deal: Deal;
  isDragging?: boolean;
}

export function DealCard({ deal, isDragging }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: deal.id,
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
      <h4 className="font-semibold text-[13px] text-[#1f2328] mb-1 line-clamp-2">
        {deal.title}
      </h4>
      <p className="text-xs text-[#6b7280]">
        {formatCurrency(deal.amount)} · {deal.probability}%
      </p>
      {deal.companyName && (
        <p className="text-xs text-[#6b7280] mt-1">{deal.companyName}</p>
      )}
      {deal.expectedCloseDate && (
        <p className="text-xs text-[#9ca3af] mt-1 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatDate(deal.expectedCloseDate)}
        </p>
      )}
    </div>
  );
}
