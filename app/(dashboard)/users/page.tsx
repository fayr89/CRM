"use client";

import { User as UserIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, ActionButton, type Column } from "@/components/common/data-table";
import { Avatar } from "@/components/common/avatar";
import { mockUsers, roleLabels } from "@/lib/mock-data";
import type { User } from "@/lib/types";
import { useRouter } from "next/navigation";

export default function UsersPage() {
  const router = useRouter();

  const columns: Column<User>[] = [
    {
      key: "name",
      label: "Имя",
      mobile: "primary",
      render: (u) => (
        <div className="flex items-center gap-2">
          <Avatar name={u.name} size="sm" />
          <span className="font-semibold">{u.name}</span>
        </div>
      ),
    },
    { key: "email", label: "Email", mobile: "secondary" },
    {
      key: "role",
      label: "Роль",
      mobile: "badge",
      render: (u) => (
        <span className="inline-flex items-center rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#3730a3]">
          {roleLabels[u.role]}
        </span>
      ),
    },
    {
      key: "active",
      label: "Статус",
      mobile: "hidden",
      render: (u) =>
        u.active ? (
          <span className="text-xs font-semibold text-[#16a34a]">Активен</span>
        ) : (
          <span className="text-xs font-semibold text-[#6b7280]">Отключён</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Пользователи"
        subtitle="Сотрудники с доступом к CRM. Новых добавляйте через раздел «Приглашения»."
      />
      <DataTable
        data={mockUsers}
        columns={columns}
        searchKeys={["name", "email"]}
        searchPlaceholder="Поиск по имени или email…"
        emptyIcon={UserIcon}
        emptyTitle="Пользователей нет"
        emptyDescription="Создайте приглашение, чтобы добавить нового сотрудника."
        toolbar={
          <ActionButton onClick={() => router.push("/invitations")}>Пригласить</ActionButton>
        }
      />
    </div>
  );
}
