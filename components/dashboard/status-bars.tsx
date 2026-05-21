interface StatusBarsProps {
  title: string;
  items: { name: string; count: number }[];
  maxCount: number;
}

export function StatusBars({ title, items, maxCount }: StatusBarsProps) {
  return (
    <div className="bg-white rounded-lg border border-[#e3e6eb] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[#1f2328] mb-4">{title}</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.name} className="flex items-center gap-3">
            <span className="text-sm text-[#6b7280] w-32 shrink-0">{item.name}</span>
            <div className="flex-1 h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#2563eb] rounded-full transition-all"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-[#1f2328] w-8 text-right">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
