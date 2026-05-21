"use client";

import { useState } from "react";
import { ClipboardList, Phone, Mail, Users, CheckSquare, AlertCircle, Check } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, ActionButton, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { mockActivities, formatDate, activityTypeLabels } from "@/lib/mock-data";
import type { Activity } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const typeIcons = {
  call: Phone,
  email: Mail,
  meeting: Users,
  task: CheckSquare,
};

const typeColors = {
  call: "bg-[#dbeafe] text-[#1e40af]",
  email: "bg-[#e0e7ff] text-[#3730a3]",
  meeting: "bg-[#fed7aa] text-[#9a3412]",
  task: "bg-[#fef3c7] text-[#92400e]",
};

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>(mockActivities);
  const isOverdue = (a: Activity) =>
    !a.completedAt && a.dueDate && new Date(a.dueDate) < new Date();

  const columns: Column<Activity>[] = [
    {
      key: "type",
      label: "Тип",
      mobile: "hidden",
      render: (a) => {
        const Icon = typeIcons[a.type];
        return (
          <span
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full",
              typeColors[a.type],
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        );
      },
    },
    {
      key: "subject",
      label: "Задача",
      mobile: "primary",
      render: (a) => {
        const Icon = typeIcons[a.type];
        return (
          <span className="flex items-center gap-2">
            <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full md:hidden", typeColors[a.type])}>
              <Icon className="h-3 w-3" />
            </span>
            <span className={cn(
              "font-semibold",
              a.completedAt && "line-through text-[#6b7280]"
            )}>
              {a.subject}
            </span>
          </span>
        );
      },
    },
    {
      key: "due",
      label: "Срок",
      mobile: "secondary",
      render: (a) => {
        if (!a.dueDate) return "—";
        return (
          <span className={cn(isOverdue(a) && "font-semibold text-[#dc2626]")}>
            {isOverdue(a) && <AlertCircle className="mr-1 inline h-3 w-3" />}
            {formatDate(a.dueDate)}
          </span>
        );
      },
    },
    {
      key: "typeMobile",
      label: "",
      mobile: "secondary",
      render: (a) => activityTypeLabels[a.type],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Задачи" subtitle="Звонки, встречи, письма, дела. Привязываются к контактам, компаниям, лидам, сделкам." />
      <DataTable
        data={activities}
        columns={columns}
        searchKeys={["subject"]}
        searchPlaceholder="Поиск по задаче…"
        emptyIcon={ClipboardList}
        emptyTitle="Задач пока нет"
        emptyDescription="Создайте задачу — она появится у вас на дашборде и в сводке «Сегодня»."
        toolbar={<ActionButton onClick={() => toast.info("Заглушка: создание задачи")}>Новая задача</ActionButton>}
        rowActions={(a) =>
          a.completedAt ? null : (
            <Button
              size="sm"
              variant="outline"
              className="border-[#16a34a] text-[#16a34a] hover:bg-[#d1fae5]"
              onClick={() => {
                setActivities((prev) =>
                  prev.map((x) =>
                    x.id === a.id ? { ...x, completedAt: new Date().toISOString() } : x,
                  ),
                );
                toast.success("Задача выполнена");
              }}
            >
              <Check className="mr-1 h-3 w-3" />
              Выполнено
            </Button>
          )
        }
      />
    </div>
  );
}
