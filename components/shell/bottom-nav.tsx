"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Package, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onOpenMenu?: () => void;
}

const items = [
  { href: "/dashboard", label: "Главная", icon: LayoutDashboard },
  { href: "/pipeline", label: "Воронка", icon: TrendingUp },
  { href: "/orders", label: "Заказы", icon: Package },
];

export function BottomNav({ onOpenMenu }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-stretch border-t border-[#e3e6eb] bg-white shadow-[0_-1px_3px_rgba(0,0,0,0.04)] lg:hidden"
      aria-label="Нижняя навигация"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors",
              active ? "text-[#2563eb]" : "text-[#6b7280] hover:text-[#1f2328]",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-semibold">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[#6b7280] hover:text-[#1f2328]"
      >
        <Menu className="h-5 w-5" />
        <span className="text-[10px] font-semibold">Меню</span>
      </button>
    </nav>
  );
}
