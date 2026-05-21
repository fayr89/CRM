"use client";

import { useState, useMemo } from "react";
import { Wallet, Plus, Check, X } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { DataTable, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  mockPayments,
  mockUsers,
  mockCurrentUser,
  formatCurrency,
  formatDateTime,
  paymentMethodLabels,
  paymentStatusLabels,
} from "@/lib/mock-data";
import type { Payment } from "@/lib/types";
import { toast } from "sonner";

export default function CashboxPage() {
  const isAdmin = mockCurrentUser.role === "admin";
  const [payments, setPayments] = useState<Payment[]>(mockPayments);
  const [managerId, setManagerId] = useState<number>(mockCurrentUser.id);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Только менеджеры
  const managers = mockUsers.filter((u) => u.role === "manager" || u.role === "sales");

  // Платежи только текущего менеджера (для admin — выбранного)
  const myPayments = useMemo(
    () => payments.filter((p) => p.managerId === managerId),
    [payments, managerId],
  );

  const filtered = useMemo(
    () => (statusFilter === "all" ? myPayments : myPayments.filter((p) => p.status === statusFilter)),
    [myPayments, statusFilter],
  );

  // Балансы
  const confirmed = myPayments
    .filter((p) => p.status === "confirmed")
    .reduce((sum, p) => sum + p.amount, 0);
  const pending = myPayments
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + p.amount, 0);

  const updatePayment = (id: number, patch: Partial<Payment>) => {
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const columns: Column<Payment>[] = [
    {
      key: "amount",
      label: "Сумма",
      mobile: "right",
      render: (p) => <span className="text-base font-bold">{formatCurrency(p.amount, p.currency)}</span>,
    },
    {
      key: "method",
      label: "Метод",
      mobile: "primary",
      render: (p) => (
        <span className="font-semibold">{p.method ? paymentMethodLabels[p.method] : "—"}</span>
      ),
    },
    {
      key: "reference",
      label: "Номер",
      mobile: "secondary",
      render: (p) => (p.reference ? <span className="font-mono text-xs">{p.reference}</span> : "—"),
    },
    {
      key: "order",
      label: "Заказ",
      mobile: "secondary",
      render: (p) => (p.orderId ? `#${p.orderId}` : "—"),
    },
    {
      key: "status",
      label: "Статус",
      mobile: "badge",
      render: (p) => <StatusBadge value={p.status} />,
    },
    {
      key: "created",
      label: "Создан",
      mobile: "hidden",
      render: (p) => formatDateTime(p.createdAt),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Касса"
        subtitle={isAdmin ? "Управление платежами всех менеджеров." : "Ваши платежи и баланс."}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить платёж
          </Button>
        }
      />

      {/* Admin manager selector */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          <Label className="text-sm font-semibold">Касса менеджера:</Label>
          <Select value={String(managerId)} onValueChange={(v) => setManagerId(Number(v))}>
            <SelectTrigger className="max-w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Balance card */}
      <div className="rounded-lg bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] p-5 text-white shadow-md sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-85">Баланс</div>
        <div className="mt-1 text-3xl font-bold sm:text-4xl">{formatCurrency(confirmed)}</div>
        <div className="mt-2 text-xs opacity-85 sm:text-sm">
          Подтверждено: <span className="font-semibold">{formatCurrency(confirmed)}</span>
          {pending > 0 && (
            <>
              {" · "}На подтверждении:{" "}
              <span className="font-semibold">{formatCurrency(pending)}</span>
            </>
          )}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="max-w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(paymentStatusLabels).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        emptyIcon={Wallet}
        emptyTitle="Платежей нет"
        emptyDescription="Добавьте первый платёж, он попадёт админу на подтверждение."
        rowActions={(p) =>
          isAdmin && p.status === "pending" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-[#16a34a] text-[#16a34a] hover:bg-[#d1fae5]"
                onClick={() => {
                  updatePayment(p.id, { status: "confirmed", confirmedAt: new Date().toISOString() });
                  toast.success("Платёж подтверждён");
                }}
              >
                <Check className="mr-1 h-3 w-3" />
                Подтвердить
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-[#dc2626] text-[#dc2626] hover:bg-[#fee2e2]"
                onClick={() => {
                  const reason = window.prompt("Причина отклонения:");
                  if (!reason) return;
                  updatePayment(p.id, { status: "rejected", rejectionReason: reason });
                  toast.info("Платёж отклонён");
                }}
              >
                <X className="mr-1 h-3 w-3" />
                Отклонить
              </Button>
            </>
          ) : null
        }
      />

      <CreatePaymentModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(p) => {
          setPayments((prev) => {
            const newPayment: Payment = {
              id: Math.max(0, ...prev.map((x) => x.id)) + 1,
              managerId: mockCurrentUser.id,
              managerName: mockCurrentUser.name,
              status: "pending",
              currency: "RUB",
              createdAt: new Date().toISOString(),
              amount: 0,
              ...p,
            };
            return [newPayment, ...prev];
          });
          toast.success("Платёж создан, ждёт подтверждения");
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function CreatePaymentModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (p: Partial<Payment>) => void;
}) {
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [orderId, setOrderId] = useState<string>("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый платёж</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Сумма, ₽ *</Label>
            <Input type="number" min={0} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Метод</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(paymentMethodLabels).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Номер транзакции</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PAY-…" />
          </div>
          <div className="space-y-1.5">
            <Label>ID заказа (опционально)</Label>
            <Input type="number" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={() => {
              if (!amount || amount <= 0) {
                toast.error("Укажите сумму");
                return;
              }
              onSubmit({
                amount,
                method: method as Payment["method"],
                reference: reference || undefined,
                orderId: orderId ? Number(orderId) : undefined,
              });
            }}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
