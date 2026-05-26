"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/common/avatar";
import { mockNotifications, roleLabels } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth";
import { 
  LayoutDashboard, 
  TrendingUp, 
  Briefcase, 
  Sprout, 
  Users, 
  Building2, 
  ClipboardList, 
  Package,
  ShoppingBag,
  Wallet,
  User,
  Mail,
  Plug,
  Search,
  Bell,
  LogOut,
  Menu,
  X,
  Truck,
  BarChart3
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
  { label: "Воронка", href: "/pipeline", icon: TrendingUp },
  { label: "Сделки", href: "/deals", icon: Briefcase },
  { label: "Лиды", href: "/leads", icon: Sprout },
  { label: "Контакты", href: "/contacts", icon: Users },
  { label: "Компании", href: "/companies", icon: Building2 },
  { label: "Задачи", href: "/activities", icon: ClipboardList },
  { label: "Прямые продажи", href: "/orders", icon: Package },
  { label: "Отгрузки", href: "/shipping", icon: Truck },
  { label: "Каталог", href: "/products", icon: ShoppingBag },
  { label: "Касса", href: "/cashbox", icon: Wallet },
];

const adminNavItems: NavItem[] = [
  { label: "Аналитика", href: "/analytics", icon: BarChart3, roles: ['admin', 'manager'] },
  { label: "Пользователи", href: "/users", icon: User, roles: ['admin', 'manager'] },
  { label: "Приглашения", href: "/invitations", icon: Mail, roles: ['admin', 'manager'] },
  { label: "Интеграции", href: "/integrations", icon: Plug, roles: ['admin'] },
];

interface SidebarProps {
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export function Sidebar({
  onOpenSearch,
  onOpenNotifications,
  mobileOpen: externalMobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const unreadCount = mockNotifications.filter(n => !n.readAt).length;
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const mobileOpen = externalMobileOpen ?? internalMobileOpen;
  const setMobileOpen = (v: boolean) => {
    if (onMobileOpenChange) onMobileOpenChange(v);
    else setInternalMobileOpen(v);
  };

  if (!user) return null;

  const canAccess = (item: NavItem) => {
    if (!item.roles) return true;
    return item.roles.includes(user.role);
  };

  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div className="p-5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="CRM" width={32} height={32} />
          <span className="text-lg font-bold text-white">CRM</span>
        </Link>
      </div>

      {/* Search Button */}
      <div className="px-3 mb-2">
        <button
          onClick={() => {
            setMobileOpen(false);
            onOpenSearch();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[#d1d5db] hover:bg-[#1f2937] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <span className="text-sm">Поиск</span>
          </span>
          <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#374151] text-[#9ca3af]">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Notifications Button */}
      <div className="px-3 mb-4">
        <button
          onClick={() => {
            setMobileOpen(false);
            onOpenNotifications();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[#d1d5db] hover:bg-[#1f2937] transition-colors"
        >
          <span className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <span className="text-sm">Уведомления</span>
          </span>
          {unreadCount > 0 && (
            <span className="min-w-5 h-5 flex items-center justify-center px-1.5 rounded-full bg-[#dc2626] text-white text-[10px] font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative",
                    isActive 
                      ? "bg-[#1f2937] text-white" 
                      : "text-[#d1d5db] hover:bg-[#1f2937] hover:text-white"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#2563eb] rounded-r" />
                  )}
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Separator */}
        <div className="my-4 border-t border-[#374151]" />

        {/* Admin Nav */}
        <ul className="space-y-0.5">
          {adminNavItems.filter(canAccess).map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative",
                    isActive 
                      ? "bg-[#1f2937] text-white" 
                      : "text-[#d1d5db] hover:bg-[#1f2937] hover:text-white"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#2563eb] rounded-r" />
                  )}
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Block */}
      <div className="p-4 border-t border-[#374151]">
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            <p className="text-xs text-[#9ca3af] truncate">{user.email}</p>
            <p className="text-[10px] text-[#6b7280] uppercase tracking-wider mt-0.5">
              {roleLabels[user.role]}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setMobileOpen(false);
            logout();
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-[#374151] text-sm text-[#d1d5db] hover:bg-[#1f2937] transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#111827] flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 text-[#d1d5db] hover:text-white"
        >
          <Menu className="w-6 h-6" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="CRM" width={28} height={28} />
          <span className="text-lg font-bold text-white">CRM</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSearch}
            className="p-2 text-[#d1d5db] hover:text-white"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            onClick={onOpenNotifications}
            className="p-2 text-[#d1d5db] hover:text-white relative"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full bg-[#dc2626] text-white text-[9px] font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div 
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-[280px] bg-[#111827] flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1 text-[#9ca3af] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[220px] bg-[#111827] flex-col z-30">
        <SidebarContent />
      </aside>
    </>
  );
}
