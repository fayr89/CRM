import { formatCurrency } from "@/lib/mock-data";
import { AlertTriangle, ClipboardList, Wallet, Sparkles } from "lucide-react";

interface TodayCardProps {
  overdueCount: number;
  pendingCount: number;
  expectedRevenue: number;
}

export function TodayCard({ overdueCount, pendingCount, expectedRevenue }: TodayCardProps) {
  const isEmpty = overdueCount === 0 && pendingCount === 0;

  return (
    <div className="bg-white rounded-lg border border-[#e3e6eb] p-4 shadow-sm">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] mb-3">
        Сегодня
      </h2>
      <ul className="space-y-2">
        {overdueCount > 0 && (
          <li className="flex items-center gap-2 text-sm text-[#dc2626]">
            <AlertTriangle className="w-4 h-4" />
            <span>{overdueCount} просроченные задачи</span>
          </li>
        )}
        {pendingCount > 0 && (
          <li className="flex items-center gap-2 text-sm text-[#1f2328]">
            <ClipboardList className="w-4 h-4 text-[#6b7280]" />
            <span>{pendingCount} задач в работе</span>
          </li>
        )}
        {expectedRevenue > 0 && (
          <li className="flex items-center gap-2 text-sm text-[#1f2328]">
            <Wallet className="w-4 h-4 text-[#6b7280]" />
            <span>Ожидаемая выручка: {formatCurrency(expectedRevenue)}</span>
          </li>
        )}
        {isEmpty && (
          <li className="flex items-center gap-2 text-sm text-[#16a34a]">
            <Sparkles className="w-4 h-4" />
            <span>Срочных дел нет. Хорошо поработать сегодня!</span>
          </li>
        )}
      </ul>
    </div>
  );
}
