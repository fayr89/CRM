"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/types";
import { DealCard } from "./deal-card";
import { formatCurrency } from "@/lib/mock-data";

interface StageColumnProps {
  id: string;
  title: string;
  count: number;
  totalAmount: number;
  deals: Deal[];
  isActive: boolean;
}

export function StageColumn({ id, title, count, totalAmount, deals, isActive }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-[280px] lg:w-auto lg:flex-1 min-w-[250px] snap-center",
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
        <span className="text-xs text-[#6b7280]">
          {count} · {formatCurrency(totalAmount)}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {deals.map(deal => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>

      {/* Empty state */}
      {deals.length === 0 && (
        <div className={cn(
          "flex items-center justify-center h-20 text-sm text-[#9ca3af]",
          isActive && "border-2 border-dashed border-[#2563eb] rounded-md"
        )}>
          {isActive ? "Отпустите здесь" : "Нет сделок"}
        </div>
      )}
    </div>
  );
}
