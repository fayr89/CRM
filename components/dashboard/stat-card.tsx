import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  subDanger?: boolean;
}

export function StatCard({ label, value, sub, subDanger }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border border-[#e3e6eb] p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] mb-1">
        {label}
      </p>
      <p className="text-2xl font-bold text-[#1f2328]">{value}</p>
      {sub && (
        <p className={cn(
          "text-xs mt-0.5",
          subDanger ? "text-[#dc2626]" : "text-[#6b7280]"
        )}>
          {sub}
        </p>
      )}
    </div>
  );
}
