"use client";

import { useState } from "react";
import { Sprout, ArrowRightCircle } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, ActionButton, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { mockLeads, formatCurrency, sourceLabels } from "@/lib/mock-data";
import type { Lead } from "@/lib/types";
import { toast } from "sonner";

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>(mockLeads);

  const columns: Column<Lead>[] = [
    {
      key: "name",
      label: "Имя",
      mobile: "primary",
      render: (l) => <span className="font-semibold">{l.firstName} {l.lastName || ""}</span>,
    },
    { key: "contact", label: "Контакт", mobile: "secondary", render: (l) => l.phone || l.email || "—" },
    { key: "company", label: "Компания", mobile: "secondary", render: (l) => l.companyName || "—" },
    { key: "source", label: "Источник", mobile: "hidden", render: (l) => sourceLabels[l.source] || l.source },
    { key: "value", label: "Сумма", mobile: "right", render: (l) => l.estimatedValue ? formatCurrency(l.estimatedValue) : "—" },
    { key: "status", label: "Статус", mobile: "badge", render: (l) => <StatusBadge value={l.status} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Лиды"
        subtitle="Потенциальные клиенты. Когда лид готов к сделке — нажмите «Конвертировать»."
      />

      <DataTable
        data={leads}
        columns={columns}
        searchKeys={["firstName", "lastName", "email", "phone", "companyName"]}
        searchPlaceholder="Поиск по имени, email или компании…"
        emptyIcon={Sprout}
        emptyTitle="Лидов пока нет"
        emptyDescription="Лиды приходят через embed-формы на сайтах, Telegram-боты и API. Также можно добавить вручную."
        toolbar={<ActionButton onClick={() => toast.info("Заглушка: создание лида")}>Новый лид</ActionButton>}
        rowActions={(l) => (
          <>
            {l.status !== "converted" && l.status !== "unqualified" && (
              <Button
                size="sm"
                variant="outline"
                className="border-[#16a34a] text-[#16a34a] hover:bg-[#d1fae5]"
                onClick={() => {
                  setLeads(prev => prev.map(x => x.id === l.id ? { ...x, status: "converted" } : x));
                  toast.success(`Лид «${l.firstName}» сконвертирован в сделку`);
                }}
              >
                <ArrowRightCircle className="mr-1 h-3 w-3" />
                Конвертировать
              </Button>
            )}
            {l.status === "new" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLeads(prev => prev.map(x => x.id === l.id ? { ...x, status: "contacted" } : x));
                  toast.info("Лид отмечен как «Контакт»");
                }}
              >
                В контакт
              </Button>
            )}
          </>
        )}
      />
    </div>
  );
}
