import { cn } from "@/lib/utils";

type BadgeVariant = 
  | 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted'  // leads
  | 'proposal' | 'negotiation' | 'won' | 'lost'  // deals
  | 'reserved' | 'shipped' | 'completed' | 'cancelled'  // orders
  | 'pending' | 'confirmed' | 'rejected';  // payments

interface StatusBadgeProps {
  value: BadgeVariant | string;
  className?: string;
}

const variantStyles: Record<string, { bg: string; text: string }> = {
  // Blue - new states
  new: { bg: 'bg-[#dbeafe]', text: 'text-[#1e40af]' },
  
  // Indigo - contacted/qualified states
  contacted: { bg: 'bg-[#e0e7ff]', text: 'text-[#3730a3]' },
  qualified: { bg: 'bg-[#c7d2fe]', text: 'text-[#3730a3]' },
  shipped: { bg: 'bg-[#e0e7ff]', text: 'text-[#3730a3]' },
  
  // Yellow - proposal/pending/reserved
  proposal: { bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
  pending: { bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
  reserved: { bg: 'bg-[#fef3c7]', text: 'text-[#92400e]' },
  
  // Orange - negotiation
  negotiation: { bg: 'bg-[#fed7aa]', text: 'text-[#9a3412]' },
  
  // Green - won/converted/completed/confirmed
  won: { bg: 'bg-[#d1fae5]', text: 'text-[#065f46]' },
  converted: { bg: 'bg-[#d1fae5]', text: 'text-[#065f46]' },
  completed: { bg: 'bg-[#d1fae5]', text: 'text-[#065f46]' },
  confirmed: { bg: 'bg-[#d1fae5]', text: 'text-[#065f46]' },
  
  // Red - lost/unqualified/rejected
  lost: { bg: 'bg-[#fee2e2]', text: 'text-[#991b1b]' },
  unqualified: { bg: 'bg-[#fee2e2]', text: 'text-[#991b1b]' },
  rejected: { bg: 'bg-[#fee2e2]', text: 'text-[#991b1b]' },
  
  // Gray - cancelled
  cancelled: { bg: 'bg-[#e5e7eb]', text: 'text-[#4b5563]' },
};

const labels: Record<string, string> = {
  // Leads
  new: 'Новый',
  contacted: 'Контакт',
  qualified: 'Квалифицирован',
  unqualified: 'Не квалифиц.',
  converted: 'Конвертирован',
  
  // Deals
  proposal: 'Предложение',
  negotiation: 'Переговоры',
  won: 'Выиграна',
  lost: 'Проиграна',
  
  // Orders
  reserved: 'Зарезервирован',
  shipped: 'Отгружен',
  completed: 'Завершён',
  cancelled: 'Отменён',
  
  // Payments
  pending: 'На подтверждении',
  confirmed: 'Подтверждён',
  rejected: 'Отклонён',
};

export function StatusBadge({ value, className }: StatusBadgeProps) {
  const style = variantStyles[value] || { bg: 'bg-[#e5e7eb]', text: 'text-[#4b5563]' };
  const label = labels[value] || value;
  
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide",
        style.bg,
        style.text,
        className
      )}
    >
      {label}
    </span>
  );
}
