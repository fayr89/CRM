"use client";

import { useState } from "react";
import Link from "next/link";
import { mockNotifications, timeAgo } from "@/lib/mock-data";
import type { Notification } from "@/lib/types";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface NotificationsDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationsDropdown({ open, onOpenChange }: NotificationsDropdownProps) {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  
  const unreadNotifications = notifications.filter(n => !n.readAt);
  const hasUnread = unreadNotifications.length > 0;

  const markAllRead = () => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
    );
  };

  const handleNotificationClick = (notification: Notification) => {
    setNotifications(prev =>
      prev.map(n => 
        n.id === notification.id 
          ? { ...n, readAt: n.readAt || new Date().toISOString() }
          : n
      )
    );
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:relative lg:inset-auto">
      <div 
        className="absolute inset-0 bg-black/40 lg:hidden"
        onClick={() => onOpenChange(false)}
      />
      
      {/* Mobile: Full screen drawer from right */}
      {/* Desktop: Floating panel */}
      <div className={cn(
        "absolute bg-white shadow-lg border border-[#e3e6eb] flex flex-col",
        "lg:top-0 lg:left-[232px] lg:w-[340px] lg:max-h-[540px] lg:rounded-lg",
        "inset-y-0 right-0 w-[320px] lg:inset-auto"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e3e6eb]">
          <h3 className="font-semibold text-[#1f2328]">Уведомления</h3>
          <div className="flex items-center gap-2">
            {hasUnread && (
              <button
                onClick={markAllRead}
                className="text-sm text-[#2563eb] hover:text-[#1d4ed8]"
              >
                Прочитать все
              </button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 text-[#6b7280] hover:text-[#1f2328]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#6b7280]">
              Уведомлений нет
            </div>
          ) : (
            <div className="divide-y divide-[#e3e6eb]">
              {notifications.map(notification => {
                const isUnread = !notification.readAt;
                return (
                  <Link
                    key={notification.id}
                    href={notification.link || '#'}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "block px-4 py-3 hover:bg-[#f9fafb] transition-colors relative",
                      isUnread && "bg-[#eff6ff]"
                    )}
                  >
                    {isUnread && (
                      <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2563eb]" />
                    )}
                    <p className={cn(
                      "text-sm text-[#1f2328]",
                      isUnread && "font-semibold"
                    )}>
                      {notification.title}
                    </p>
                    {notification.body && (
                      <p className="text-sm text-[#6b7280] mt-0.5 line-clamp-2">
                        {notification.body}
                      </p>
                    )}
                    <p className="text-[11px] text-[#9ca3af] mt-1">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
