import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="w-16 h-16 rounded-full bg-[#f3f4f6] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[#9ca3af]" />
      </div>
      <h3 className="text-base font-semibold text-[#1f2328] mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-[#6b7280] max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
