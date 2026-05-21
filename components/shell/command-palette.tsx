"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { 
  mockContacts, 
  mockCompanies, 
  mockLeads, 
  mockDeals, 
  mockOrders,
  formatCurrency
} from "@/lib/mock-data";
import { Sprout, Users, Building2, Briefcase, Package, Search, X } from "lucide-react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const router = useRouter();

  const handleSelect = useCallback((href: string) => {
    onOpenChange(false);
    setSearch("");
    router.push(href);
  }, [router, onOpenChange]);

  // Global keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Filter results
  const filteredLeads = search.length >= 2 
    ? mockLeads.filter(l => 
        l.firstName.toLowerCase().includes(search.toLowerCase()) ||
        l.lastName?.toLowerCase().includes(search.toLowerCase()) ||
        l.email?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 3)
    : [];

  const filteredContacts = search.length >= 2
    ? mockContacts.filter(c =>
        c.firstName.toLowerCase().includes(search.toLowerCase()) ||
        c.lastName?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 3)
    : [];

  const filteredCompanies = search.length >= 2
    ? mockCompanies.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 3)
    : [];

  const filteredDeals = search.length >= 2
    ? mockDeals.filter(d =>
        d.title.toLowerCase().includes(search.toLowerCase()) ||
        d.companyName?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 3)
    : [];

  const filteredOrders = search.length >= 2
    ? mockOrders.filter(o =>
        o.clientName?.toLowerCase().includes(search.toLowerCase()) ||
        o.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
        String(o.id).includes(search)
      ).slice(0, 3)
    : [];

  const hasResults = filteredLeads.length + filteredContacts.length + filteredCompanies.length + filteredDeals.length + filteredOrders.length > 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div 
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-full max-w-[600px] px-4">
        <Command className="bg-white rounded-lg shadow-lg overflow-hidden border border-[#e3e6eb]">
          <div className="flex items-center gap-3 px-4 border-b border-[#e3e6eb]">
            <Search className="w-5 h-5 text-[#6b7280]" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Поиск по контактам, компаниям, лидам, сделкам, заказам…"
              className="flex-1 py-4 text-base outline-none placeholder:text-[#9ca3af]"
              autoFocus
            />
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 text-[#6b7280] hover:text-[#1f2328]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            {search.length < 2 && (
              <Command.Empty className="py-8 text-center text-sm text-[#6b7280]">
                Введите минимум 2 символа…
              </Command.Empty>
            )}

            {search.length >= 2 && !hasResults && (
              <Command.Empty className="py-8 text-center text-sm text-[#6b7280]">
                Ничего не найдено
              </Command.Empty>
            )}

            {filteredLeads.length > 0 && (
              <Command.Group heading="Лиды" className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] flex items-center gap-1.5">
                  <Sprout className="w-3.5 h-3.5" />
                  Лиды
                </div>
                {filteredLeads.map(lead => (
                  <Command.Item
                    key={`lead-${lead.id}`}
                    value={`lead-${lead.id}`}
                    onSelect={() => handleSelect('/leads')}
                    className="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-[#eff6ff] data-[selected=true]:bg-[#eff6ff]"
                  >
                    <span className="font-medium text-[#1f2328]">
                      {lead.firstName} {lead.lastName}
                    </span>
                    <span className="text-sm text-[#6b7280]">{lead.email}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredContacts.length > 0 && (
              <Command.Group heading="Контакты" className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Контакты
                </div>
                {filteredContacts.map(contact => (
                  <Command.Item
                    key={`contact-${contact.id}`}
                    value={`contact-${contact.id}`}
                    onSelect={() => handleSelect('/contacts')}
                    className="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-[#eff6ff] data-[selected=true]:bg-[#eff6ff]"
                  >
                    <span className="font-medium text-[#1f2328]">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className="text-sm text-[#6b7280]">{contact.phone}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredCompanies.length > 0 && (
              <Command.Group heading="Компании" className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  Компании
                </div>
                {filteredCompanies.map(company => (
                  <Command.Item
                    key={`company-${company.id}`}
                    value={`company-${company.id}`}
                    onSelect={() => handleSelect('/companies')}
                    className="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-[#eff6ff] data-[selected=true]:bg-[#eff6ff]"
                  >
                    <span className="font-medium text-[#1f2328]">{company.name}</span>
                    <span className="text-sm text-[#6b7280]">{company.industry}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredDeals.length > 0 && (
              <Command.Group heading="Сделки" className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" />
                  Сделки
                </div>
                {filteredDeals.map(deal => (
                  <Command.Item
                    key={`deal-${deal.id}`}
                    value={`deal-${deal.id}`}
                    onSelect={() => handleSelect('/deals')}
                    className="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-[#eff6ff] data-[selected=true]:bg-[#eff6ff]"
                  >
                    <span className="font-medium text-[#1f2328]">{deal.title}</span>
                    <span className="text-sm text-[#6b7280]">{formatCurrency(deal.amount)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {filteredOrders.length > 0 && (
              <Command.Group heading="Заказы" className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" />
                  Заказы
                </div>
                {filteredOrders.map(order => (
                  <Command.Item
                    key={`order-${order.id}`}
                    value={`order-${order.id}`}
                    onSelect={() => handleSelect('/orders')}
                    className="flex items-center justify-between px-3 py-2 rounded-md cursor-pointer hover:bg-[#eff6ff] data-[selected=true]:bg-[#eff6ff]"
                  >
                    <span className="font-medium text-[#1f2328]">
                      #{order.id} {order.clientName}
                    </span>
                    <span className="text-sm text-[#6b7280]">{formatCurrency(order.totalAmount)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div className="px-4 py-2 border-t border-[#e3e6eb] text-[11px] text-[#9ca3af]">
            Esc — закрыть · ↑↓ — навигация · Enter — открыть
          </div>
        </Command>
      </div>
    </div>
  );
}
