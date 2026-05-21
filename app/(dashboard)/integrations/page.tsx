"use client";

import { useState } from "react";
import { Plug, Plus, Trash2, Copy, Webhook, KeySquare, FileCode } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { HelpBanner } from "@/components/common/help-banner";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mockApiTokens, mockWebhooks, formatDateTime } from "@/lib/mock-data";
import type { ApiToken, Webhook as WebhookT } from "@/lib/types";
import { toast } from "sonner";

export default function IntegrationsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Интеграции"
        subtitle="Подключите свои сайты, лендинги, Telegram-боты и внешние системы к CRM."
      />

      <HelpBanner>
        API-токены — внешние системы шлют нам лиды и заказы. Вебхуки — наоборот, мы шлём вашим системам события (новый заказ, отгрузка, платёж).
      </HelpBanner>

      <Tabs defaultValue="tokens">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="tokens" className="flex-1 sm:flex-none">
            <KeySquare className="mr-1 h-3.5 w-3.5" />
            API-токены
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="flex-1 sm:flex-none">
            <Webhook className="mr-1 h-3.5 w-3.5" />
            Вебхуки
          </TabsTrigger>
          <TabsTrigger value="docs" className="flex-1 sm:flex-none">
            <FileCode className="mr-1 h-3.5 w-3.5" />
            Документация
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tokens">
          <TokensSection />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksSection />
        </TabsContent>
        <TabsContent value="docs">
          <DocsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TokensSection() {
  const [tokens, setTokens] = useState<ApiToken[]>(mockApiTokens);
  const [createOpen, setCreateOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const handleCreate = (name: string, scopes: string[]) => {
    const fake = `crm_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
    const prefix = `${fake.slice(0, 8)}...${fake.slice(-3)}`;
    const t: ApiToken = {
      id: Math.max(0, ...tokens.map((t) => t.id)) + 1,
      name,
      tokenPrefix: prefix,
      scopes: scopes.join(", "),
      createdAt: new Date().toISOString(),
    };
    setTokens([t, ...tokens]);
    setNewToken(fake);
    setCreateOpen(false);
  };

  const revoke = (id: number) => {
    if (!window.confirm("Точно отозвать токен?")) return;
    setTokens((prev) => prev.filter((t) => t.id !== id));
    toast.info("Токен отозван");
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Новый токен
        </Button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState
          icon={KeySquare}
          title="Токенов нет"
          description="Создайте токен и используйте его в заголовке X-API-Token при запросах к /api/external/*."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e3e6eb] bg-white shadow-sm">
          <div className="hidden md:block">
            <table className="w-full">
              <thead className="border-b border-[#e3e6eb] bg-[#f9fafb]">
                <tr>
                  <Th>Название</Th>
                  <Th>Префикс</Th>
                  <Th>Права</Th>
                  <Th>Последнее использование</Th>
                  <Th>Создан</Th>
                  <Th className="text-right">Действия</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e6eb]">
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-semibold">{t.name}</Td>
                    <Td><code className="rounded bg-[#f3f4f6] px-1.5 py-0.5 text-xs">{t.tokenPrefix}</code></Td>
                    <Td><code className="text-xs">{t.scopes}</code></Td>
                    <Td className="text-xs text-[#6b7280]">{t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "ни разу"}</Td>
                    <Td className="text-xs text-[#6b7280]">{formatDateTime(t.createdAt)}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" className="border-[#dc2626] text-[#dc2626] hover:bg-[#fee2e2]" onClick={() => revoke(t.id)}>
                        <Trash2 className="mr-1 h-3 w-3" />
                        Отозвать
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <div className="divide-y divide-[#e3e6eb] md:hidden">
            {tokens.map((t) => (
              <div key={t.id} className="p-3 text-sm">
                <div className="font-semibold">{t.name}</div>
                <div className="mt-1 text-xs text-[#6b7280]">
                  <code className="rounded bg-[#f3f4f6] px-1.5 py-0.5">{t.tokenPrefix}</code>
                </div>
                <div className="mt-1 text-xs"><code>{t.scopes}</code></div>
                <div className="mt-1 text-xs text-[#6b7280]">
                  Создан: {formatDateTime(t.createdAt)}
                </div>
                <Button size="sm" variant="outline" className="mt-2 border-[#dc2626] text-[#dc2626] hover:bg-[#fee2e2]" onClick={() => revoke(t.id)}>
                  <Trash2 className="mr-1 h-3 w-3" />
                  Отозвать
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateTokenModal open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <NewTokenModal value={newToken} onClose={() => setNewToken(null)} />
    </div>
  );
}

function CreateTokenModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, scopes: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["leads:create"]);

  const toggle = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый API-токен</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Лендинг example.com" />
            <p className="text-xs text-[#6b7280]">Удобно понять, кому выдан токен.</p>
          </div>
          <div className="space-y-2">
            <Label>Права</Label>
            {[
              { v: "leads:create", l: "Создавать лидов" },
              { v: "orders:create", l: "Создавать заказы" },
              { v: "products:read", l: "Читать каталог" },
            ].map((s) => (
              <label key={s.v} className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={scopes.includes(s.v)} onCheckedChange={() => toggle(s.v)} />
                <span className="text-sm">{s.l} <code className="ml-1 text-[10px] text-[#6b7280]">{s.v}</code></span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                toast.error("Укажите название");
                return;
              }
              if (scopes.length === 0) {
                toast.error("Выберите хотя бы одно право");
                return;
              }
              onCreate(name.trim(), scopes);
            }}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTokenModal({ value, onClose }: { value: string | null; onClose: () => void }) {
  if (!value) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Токен создан</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">
            <strong className="text-[#dc2626]">Сохраните токен сейчас.</strong> После закрытия этого окна показать его повторно нельзя.
          </p>
          <div className="rounded-md bg-[#1f2328] p-3 font-mono text-sm text-[#d1fae5] break-all">
            {value}
          </div>
          <Button
            className="w-full"
            onClick={() => {
              navigator.clipboard?.writeText(value).then(() => {
                toast.success("Скопировано в буфер");
              });
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Скопировать
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">Я сохранил, закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookT[]>(mockWebhooks);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Новый вебхук
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="Вебхуков нет"
          description="Подключите вебхук, чтобы получать уведомления о новых заказах, отгрузках, платежах в свои системы."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e3e6eb] bg-white shadow-sm">
          <div className="hidden md:block">
            <table className="w-full">
              <thead className="border-b border-[#e3e6eb] bg-[#f9fafb]">
                <tr>
                  <Th>Название</Th>
                  <Th>URL</Th>
                  <Th>События</Th>
                  <Th>Доставки</Th>
                  <Th>Последний код</Th>
                  <Th>Активен</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e6eb]">
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <Td className="font-semibold">{w.name}</Td>
                    <Td><code className="block max-w-[300px] truncate text-xs">{w.url}</code></Td>
                    <Td><code className="text-xs">{w.events}</code></Td>
                    <Td className="text-xs">{w.deliveriesCount}</Td>
                    <Td className="text-xs">
                      {w.lastStatusCode ? (
                        <span className={w.lastStatusCode < 300 ? "font-bold text-[#16a34a]" : "font-bold text-[#dc2626]"}>
                          {w.lastStatusCode}
                        </span>
                      ) : "—"}
                    </Td>
                    <Td>
                      <Switch
                        checked={w.active}
                        onCheckedChange={(c) =>
                          setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, active: c } : x)))
                        }
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <div className="divide-y divide-[#e3e6eb] md:hidden">
            {webhooks.map((w) => (
              <div key={w.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{w.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[#6b7280]"><code>{w.url}</code></div>
                  </div>
                  <Switch
                    checked={w.active}
                    onCheckedChange={(c) =>
                      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, active: c } : x)))
                    }
                  />
                </div>
                <div className="mt-1 text-xs"><code>{w.events}</code></div>
                <div className="mt-1 text-xs text-[#6b7280]">
                  {w.deliveriesCount} доставок ·{" "}
                  {w.lastStatusCode ? (
                    <span className={w.lastStatusCode < 300 ? "font-bold text-[#16a34a]" : "font-bold text-[#dc2626]"}>
                      HTTP {w.lastStatusCode}
                    </span>
                  ) : "никогда не запускался"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateWebhookModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(name, url, events) => {
          setWebhooks([
            {
              id: Math.max(0, ...webhooks.map((w) => w.id)) + 1,
              name,
              url,
              events,
              active: true,
              deliveriesCount: 0,
            },
            ...webhooks,
          ]);
          toast.success("Вебхук создан");
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function CreateWebhookModal({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, url: string, events: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("order.created, order.shipped");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый вебхук</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Уведомления в Telegram" />
          </div>
          <div className="space-y-1.5">
            <Label>URL *</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/webhook" />
          </div>
          <div className="space-y-1.5">
            <Label>События (через запятую)</Label>
            <Textarea value={events} onChange={(e) => setEvents(e.target.value)} rows={2} />
            <p className="text-xs text-[#6b7280]">
              Доступные: <code>order.created</code>, <code>order.reserved</code>, <code>order.shipped</code>, <code>order.completed</code>, <code>order.cancelled</code>, <code>payment.confirmed</code>, <code>lead.created</code>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={() => {
              if (!name.trim() || !url.trim()) {
                toast.error("Заполните название и URL");
                return;
              }
              if (!url.startsWith("http")) {
                toast.error("URL должен начинаться с http:// или https://");
                return;
              }
              onCreate(name.trim(), url.trim(), events);
            }}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocsSection() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DocCard
        title="Embed-форма на лендинг"
        body={
          <>
            <p className="text-sm text-[#6b7280]">Вставьте на страницу — она будет принимать заявки и отправлять их в CRM как лиды.</p>
            <pre className="mt-2 overflow-x-auto rounded bg-[#1f2328] p-3 text-xs text-[#d1fae5]">
{`<script
  src="https://crm.example.com/embed/form.js"
  data-token="ВАШ_ТОКЕН"
  data-source="website"
></script>`}
            </pre>
          </>
        }
      />
      <DocCard
        title="REST API"
        body={
          <>
            <p className="text-sm text-[#6b7280]">Слать данные напрямую — через любой HTTP-клиент.</p>
            <pre className="mt-2 overflow-x-auto rounded bg-[#1f2328] p-3 text-xs text-[#d1fae5]">
{`POST /api/external/leads
X-API-Token: ВАШ_ТОКЕН
Content-Type: application/json

{
  "firstName": "Иван",
  "phone": "+7...",
  "source": "site"
}`}
            </pre>
          </>
        }
      />
      <DocCard
        title="Telegram-бот"
        body={
          <>
            <p className="text-sm text-[#6b7280]">
              Пример в репозитории: <code>examples/telegram-bot/</code>. Принимает сообщения, создаёт лидов в CRM. Запускается как отдельный процесс.
            </p>
          </>
        }
      />
      <DocCard
        title="Webhook на ваш сервер"
        body={
          <>
            <p className="text-sm text-[#6b7280]">При каждом событии (заказ создан/отгружен/оплачен) — POST на ваш URL с JSON-телом. Подпись HMAC-SHA256 в заголовке X-Signature.</p>
          </>
        }
      />
    </div>
  );
}

function DocCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e3e6eb] bg-white p-4 shadow-sm">
      <h3 className="mb-2 font-semibold text-[#1f2328]">{title}</h3>
      {body}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280] ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-[#1f2328] ${className}`}>{children}</td>;
}
