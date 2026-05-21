"use client";

import { useState } from "react";
import { Mail, Copy, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mockInvitations, formatDateTime, roleLabels } from "@/lib/mock-data";
import type { Invitation, Role } from "@/lib/types";
import { toast } from "sonner";

export default function InvitationsPage() {
  const [invites, setInvites] = useState<Invitation[]>(mockInvitations);
  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("sales");

  const getStatus = (i: Invitation) => {
    if (i.acceptedAt) return { label: "Принято", className: "bg-[#d1fae5] text-[#065f46]" };
    if (new Date(i.expiresAt) < new Date()) return { label: "Просрочено", className: "bg-[#fee2e2] text-[#991b1b]" };
    return { label: "Ожидает", className: "bg-[#fef3c7] text-[#92400e]" };
  };

  const columns: Column<Invitation>[] = [
    { key: "email", label: "Email", mobile: "primary", render: (i) => <span className="font-semibold">{i.email}</span> },
    { key: "role", label: "Роль", mobile: "secondary", render: (i) => roleLabels[i.role] },
    { key: "invitedBy", label: "Пригласил", mobile: "secondary", render: (i) => i.invitedByName },
    { key: "expires", label: "Истекает", mobile: "hidden", render: (i) => formatDateTime(i.expiresAt) },
    {
      key: "status",
      label: "Статус",
      mobile: "badge",
      render: (i) => {
        const s = getStatus(i);
        return (
          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.className}`}>
            {s.label}
          </span>
        );
      },
    },
  ];

  const handleCreate = () => {
    if (!email.includes("@")) {
      toast.error("Введите корректный email");
      return;
    }
    const newInvite: Invitation = {
      id: Math.max(0, ...invites.map((i) => i.id)) + 1,
      email,
      role,
      invitedBy: 2,
      invitedByName: "Мария Иванова",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    setInvites([newInvite, ...invites]);
    toast.success("Приглашение создано");
    setCreateOpen(false);
    setEmail("");
    setRole("sales");
  };

  const copyLink = (i: Invitation) => {
    const url = `${window.location.origin}/accept?token=demo-${i.id}`;
    navigator.clipboard?.writeText(url).then(() => {
      toast.success("Ссылка скопирована");
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Приглашения"
        subtitle="Чтобы пригласить нового сотрудника — отправьте ему ссылку. По ней он создаст аккаунт."
      />

      <DataTable
        data={invites}
        columns={columns}
        searchKeys={["email"]}
        searchPlaceholder="Поиск по email…"
        emptyIcon={Mail}
        emptyTitle="Приглашений нет"
        emptyDescription="Создайте первое приглашение, отправьте ссылку коллеге."
        toolbar={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Новое приглашение
          </Button>
        }
        rowActions={(i) =>
          i.acceptedAt ? null : (
            <Button size="sm" variant="outline" onClick={() => copyLink(i)}>
              <Copy className="mr-1 h-3 w-3" />
              Скопировать ссылку
            </Button>
          )
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новое приглашение</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.ru" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Роль *</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Менеджер</SelectItem>
                  <SelectItem value="sales">Продажник</SelectItem>
                  <SelectItem value="warehouse">Склад</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-[#6b7280]">Срок действия ссылки — 7 дней.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
