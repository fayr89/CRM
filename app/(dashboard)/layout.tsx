"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationsDropdown } from "@/components/shell/notifications-dropdown";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <Sidebar 
        onOpenSearch={() => setSearchOpen(true)} 
        onOpenNotifications={() => setNotificationsOpen(true)}
      />
      
      <main className="lg:ml-[220px] pt-14 lg:pt-0 min-h-screen">
        <div className="p-4 lg:p-6">
          {children}
        </div>
      </main>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <NotificationsDropdown open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </div>
  );
}
