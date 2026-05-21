"use client";

import { Users } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, ActionButton, type Column } from "@/components/common/data-table";
import { Avatar } from "@/components/common/avatar";
import { mockContacts, mockCompanies } from "@/lib/mock-data";
import type { Contact } from "@/lib/types";
import { toast } from "sonner";

export default function ContactsPage() {
  const getCompany = (id?: number) => mockCompanies.find((c) => c.id === id)?.name || "—";

  const columns: Column<Contact>[] = [
    {
      key: "name",
      label: "Имя",
      mobile: "primary",
      render: (c) => (
        <div className="flex items-center gap-2">
          <Avatar name={`${c.firstName} ${c.lastName || ""}`} size="sm" />
          <span className="font-semibold">{c.firstName} {c.lastName || ""}</span>
        </div>
      ),
    },
    { key: "position", label: "Должность", mobile: "secondary", render: (c) => c.position || "—" },
    { key: "company", label: "Компания", mobile: "secondary", render: (c) => getCompany(c.companyId) },
    { key: "email", label: "Email", mobile: "hidden", render: (c) => c.email || "—" },
    { key: "phone", label: "Телефон", mobile: "hidden", render: (c) => c.phone || "—" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Контакты" subtitle="Конкретные люди — представители компаний. Привязываются к сделкам и задачам." />
      <DataTable
        data={mockContacts}
        columns={columns}
        searchKeys={["firstName", "lastName", "email", "phone", "position"]}
        searchPlaceholder="Поиск по имени, email, должности…"
        emptyIcon={Users}
        emptyTitle="Контактов пока нет"
        emptyDescription="Добавьте первого контакта — он сможет быть участником сделки или адресатом задачи."
        toolbar={<ActionButton onClick={() => toast.info("Заглушка: создание контакта")}>Новый контакт</ActionButton>}
      />
    </div>
  );
}
