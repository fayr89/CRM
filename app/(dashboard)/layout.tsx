"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationsDropdown } from "@/components/shell/notifications-dropdown";
import { useAuth } from "@/lib/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f4f5f7]">
        <span className="w-6 h-6 border-2 border-[#2563eb]/30 border-t-[#2563eb] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <Sidebar
        onOpenSearch={() => setSearchOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        mobileOpen={mobileMenuOpen}
        onMobileOpenChange={setMobileMenuOpen}
      />

      <main className="min-h-screen pt-14 pb-16 lg:ml-[220px] lg:pb-0 lg:pt-0">
        <div className="p-4 lg:p-6">{children}</div>
      </main>

      <BottomNav onOpenMenu={() => setMobileMenuOpen(true)} />

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <NotificationsDropdown open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </div>
  );
}
