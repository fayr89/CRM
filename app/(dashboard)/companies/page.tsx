"use client";

import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, ActionButton, type Column } from "@/components/common/data-table";
import { mockCompanies, formatCurrency, formatDate, sizeLabels } from "@/lib/mock-data";
import type { Company } from "@/lib/types";
import { toast } from "sonner";

export default function CompaniesPage() {
  const columns: Column<Company>[] = [
    { key: "name", label: "Название", mobile: "primary", render: (c) => <span className="font-semibold">{c.name}</span> },
    { key: "industry", label: "Отрасль", mobile: "secondary", render: (c) => c.industry || "—" },
    { key: "size", label: "Размер", mobile: "hidden", render: (c) => c.size ? sizeLabels[c.size] : "—" },
    { key: "revenue", label: "Выручка", mobile: "right", render: (c) => c.annualRevenue ? formatCurrency(c.annualRevenue) : "—" },
    { key: "created", label: "Создана", mobile: "hidden", render: (c) => formatDate(c.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Компании" subtitle="Юрлица, с которыми ведутся сделки. К компании привязываются контакты, лиды и заказы." />
      <DataTable
        data={mockCompanies}
        columns={columns}
        searchKeys={["name", "industry"]}
        searchPlaceholder="Поиск по названию или отрасли…"
        emptyIcon={Building2}
        emptyTitle="Компаний пока нет"
        emptyDescription="Добавьте первую компанию — и сможете привязывать к ней контакты, сделки, заказы."
        toolbar={<ActionButton onClick={() => toast.info("Заглушка: создание компании")}>Новая компания</ActionButton>}
      />
    </div>
  );
}
