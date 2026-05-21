"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationsDropdown } from "@/components/shell/notifications-dropdown";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
