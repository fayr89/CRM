"use client";

import { useState, useMemo } from "react";
import { Truck, Download, Save } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { HelpBanner } from "@/components/common/help-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  mockSchedule,
  mockOrders,
  mockCurrentUser,
  weekdayLabels,
  nextShippingDate,
  formatCurrency,
  formatDateTime,
} from "@/lib/mock-data";
import type { Weekday, ShippingSchedule } from "@/lib/types";
import { toast } from "sonner";

const ALL_DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function ShippingPage() {
  const me = mockCurrentUser;
  const canEdit = me.role === "warehouse" || me.role === "admin";

  const [schedule, setSchedule] = useState<ShippingSchedule>(mockSchedule);
  const [showHelp, setShowHelp] = useState(true);

  const next = useMemo(
    () => nextShippingDate(schedule.days, schedule.cutoffTime),
    [schedule.days, schedule.cutoffTime],
  );

  const reservedOrders = useMemo(
    () => mockOrders.filter((o) => o.status === "reserved"),
    [],
  );

  const toggleDay = (day: Weekday) => {
    if (!canEdit) return;
    setSchedule((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day],
    }));
  };

  const save = () => {
    if (schedule.days.length === 0) {
      toast.error("Выберите хотя бы один день");
      return;
    }
    // На реальном API: PUT /api/warehouse/schedule
    toast.success("Расписание сохранено");
  };

  const exportCsv = () => {
    // Реальный экспорт: GET /api/orders/export.csv?status=reserved
    const rows = [
      ["№", "Площадка", "Клиент", "Менеджер", "Зарезервирован", "Сумма", "Позиций"],
      ...reservedOrders.map((o) => [
        `#${o.id}`,
        o.marketplace || "",
        o.clientName || "",
        o.managerName || "",
        o.reservedAt || "",
        String(o.totalAmount),
        String(o.itemsCount || 0),
      ]),
    ];
    const csv =
      "﻿" +
      rows.map((r) => r.map((v) => (String(v).includes(";") ? `"${v}"` : v)).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Выгружено ${reservedOrders.length} заказов в Excel`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="График отгрузок"
        subtitle={
          canEdit
            ? "Настройте дни недели и время отсечки. Менеджеры видят ближайшую дату."
            : "Расписание устанавливает склад. Здесь показана ближайшая дата."
        }
      />

      {showHelp && (
        <HelpBanner onDismiss={() => setShowHelp(false)}>
          {canEdit
            ? "Отметьте дни недели когда вы отгружаете. Заказы поданные после времени отсечки переедут на следующий день."
            : "Учитывайте дни отгрузки при общении с клиентами — заказ уедет не раньше ближайшей даты ниже."}
        </HelpBanner>
      )}

      {/* Ближайшая дата */}
      <div className="rounded-lg bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] p-5 text-white shadow-md sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-85">
          Ближайшая отгрузка
        </div>
        <div className="mt-1 text-2xl font-bold sm:text-3xl">
          {next
            ? next.toLocaleDateString("ru-RU", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : "—"}
        </div>
        <div className="mt-2 text-xs opacity-85 sm:text-sm">
          {next && next.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          {" · "}
          {reservedOrders.length} зарезервированных заказов готовы к отгрузке
        </div>
      </div>

      {/* Дни недели */}
      <div className="rounded-lg border border-[#e3e6eb] bg-white p-4 shadow-sm sm:p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#6b7280]">
          Дни отгрузки
        </h3>
        <div className="flex flex-wrap gap-2">
          {ALL_DAYS.map((day) => {
            const active = schedule.days.includes(day);
            return (
              <label
                key={day}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition-all",
                  active
                    ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                    : "border-[#e3e6eb] bg-white text-[#6b7280] hover:border-[#9ca3af]",
                  !canEdit && "cursor-default opacity-80",
                )}
              >
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggleDay(day)}
                  disabled={!canEdit}
                />
                <span>{weekdayLabels[day]}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Время отсечки (HH:MM)</Label>
            <Input
              type="time"
              value={schedule.cutoffTime}
              onChange={(e) => setSchedule({ ...schedule, cutoffTime: e.target.value })}
              disabled={!canEdit}
            />
            <p className="text-xs text-[#6b7280]">
              Заказ поданный после этого времени переедет на следующий день отгрузки.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label>Заметки</Label>
          <Textarea
            value={schedule.notes || ""}
            onChange={(e) => setSchedule({ ...schedule, notes: e.target.value })}
            disabled={!canEdit}
            placeholder="Например, особенности забора, контакты курьеров…"
          />
        </div>

        {canEdit && (
          <div className="mt-4 flex justify-end">
            <Button onClick={save}>
              <Save className="mr-2 h-4 w-4" />
              Сохранить расписание
            </Button>
          </div>
        )}
      </div>

      {/* Список заказов к отгрузке */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[#1f2328]">
            Заказы к отгрузке ({reservedOrders.length})
          </h3>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Выгрузить в Excel
          </Button>
        </div>

        {reservedOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#e3e6eb] bg-white p-8 text-center text-sm text-[#6b7280]">
            Нет зарезервированных заказов. Когда менеджеры зарезервируют заказы, они появятся здесь.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {reservedOrders.map((o) => (
                <div
                  key={o.id}
                  className="rounded-lg border border-[#e3e6eb] bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">#{o.id} · {o.clientName}</div>
                      <div className="mt-0.5 text-xs text-[#6b7280]">
                        {o.marketplace} {o.referenceNumber ? `· ${o.referenceNumber}` : ""}
                      </div>
                      <div className="mt-0.5 text-xs text-[#6b7280]">
                        {o.managerName} · {o.itemsCount || 0} поз.
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{formatCurrency(o.totalAmount, o.currency)}</div>
                      <div className="text-[10px] text-[#6b7280]">
                        {o.reservedAt ? formatDateTime(o.reservedAt) : ""}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-lg border border-[#e3e6eb] bg-white shadow-sm md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[#e3e6eb] bg-[#f9fafb]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">№</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Площадка</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Клиент</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Менеджер</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Зарезервирован</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Сумма</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Позиций</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e3e6eb]">
                    {reservedOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#f9fafb]">
                        <td className="px-4 py-3 font-semibold">#{o.id}</td>
                        <td className="px-4 py-3 text-[#6b7280]">{o.marketplace || "—"}</td>
                        <td className="px-4 py-3">{o.clientName || "—"}</td>
                        <td className="px-4 py-3 text-[#6b7280]">{o.managerName || "—"}</td>
                        <td className="px-4 py-3 text-xs text-[#6b7280]">
                          {o.reservedAt ? formatDateTime(o.reservedAt) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {formatCurrency(o.totalAmount, o.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-[#6b7280]">{o.itemsCount || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
