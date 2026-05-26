"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Image from "next/image";
import { Package, Plus, Download, Search, ImageOff } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { HelpBanner } from "@/components/common/help-banner";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/mock-data";
import type { Product, Marketplace } from "@/lib/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MARKETPLACES: Marketplace[] = ["Wildberries", "Ozon", "Яндекс.Маркет", "Avito", "Другое"];

interface RawProduct {
  id: number;
  sku: string | null;
  name: string;
  image_url: string | null;
  cost_price: number | string;
  unit: string | null;
  description: string | null;
  external_source: string | null;
  active: boolean;
  price_count?: number;
  prices?: { marketplace: string; price: number | string }[];
}

function mapProduct(r: RawProduct): Product {
  return {
    id: r.id,
    sku: r.sku ?? undefined,
    name: r.name,
    imageUrl: r.image_url ?? undefined,
    costPrice: Number(r.cost_price ?? 0),
    unit: r.unit ?? "шт",
    description: r.description ?? undefined,
    externalSource: r.external_source === "moysklad" ? "moysklad" : undefined,
    active: !!r.active,
    priceCount: r.price_count ?? (r.prices ? r.prices.length : 0),
    prices: r.prices?.map((p) => ({ marketplace: p.marketplace, price: Number(p.price) })),
  };
}

async function fetchAllProducts(): Promise<Product[]> {
  const limit = 200;
  const acc: Product[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const res = await api.get<{ data: RawProduct[]; pagination?: { total?: number } }>(
      `/api/products?limit=${limit}&page=${page}`,
    );
    acc.push(...res.data.map(mapProduct));
    const total = res.pagination?.total ?? acc.length;
    if (res.data.length === 0 || acc.length >= total) break;
  }
  return acc;
}

export default function ProductsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const canEdit = role === "admin" || role === "manager";
  const canImport = role === "admin";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showHelp, setShowHelp] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await fetchAllProducts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить товары");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q),
    );
  }, [products, search]);

  const openEditor = async (p: Product) => {
    if (!canEdit) return;
    try {
      const full = await api.get<RawProduct>(`/api/products/${p.id}`);
      setEditing(mapProduct(full));
    } catch {
      setEditing(p);
    }
  };

  const handleSave = async (form: Product) => {
    const payload = {
      sku: form.sku || null,
      name: form.name,
      image_url: form.imageUrl || null,
      cost_price: Number(form.costPrice) || 0,
      unit: form.unit || "шт",
      description: form.description || null,
      active: form.active,
    };
    const isEdit = !!editing;
    try {
      let id = form.id;
      if (isEdit) {
        await api.patch(`/api/products/${id}`, payload);
      } else {
        const created = await api.post<RawProduct>("/api/products", payload);
        id = created.id;
      }
      const original = editing?.prices ?? [];
      for (const m of MARKETPLACES) {
        const np = (form.prices ?? []).find((p) => p.marketplace === m)?.price ?? 0;
        if (np > 0) {
          await api.put(`/api/products/${id}/prices`, { marketplace: m, price: np });
        } else if (original.find((p) => p.marketplace === m)) {
          await api.del(`/api/products/${id}/prices/${encodeURIComponent(m)}`);
        }
      }
      toast.success(isEdit ? "Товар обновлён" : "Товар создан");
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Каталог товаров"
        subtitle="Себестоимость, картинки и прайсы по площадкам. Используется в форме заказа."
      />

      {showHelp && (
        <HelpBanner onDismiss={() => setShowHelp(false)}>
          Прайс по площадке = цена этого товара для конкретного маркетплейса/лендинга. При создании заказа подставится автоматически.
        </HelpBanner>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
          <Input
            placeholder="Поиск по названию или SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex-1" />
        {canImport && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Download className="mr-2 h-4 w-4" />
            Импорт из МойСклад
          </Button>
        )}
        {canEdit && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Новый товар
          </Button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid place-items-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#2563eb]/30 border-t-[#2563eb]" />
        </div>
      ) : error ? (
        <div className="rounded-md bg-[#fee2e2] p-4 text-sm text-[#991b1b]">
          {error}
          <button onClick={load} className="ml-2 font-semibold underline">
            Повторить
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={search ? "Ничего не найдено" : "Каталог пуст"}
          description={
            search
              ? `По запросу «${search}» совпадений нет.`
              : "Добавьте первый товар вручную или импортируйте из МойСклада. Себестоимость и картинки подтянутся автоматически."
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              clickable={canEdit}
              onClick={() => openEditor(p)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {(editing || creating) && (
        <ProductFormModal
          product={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={handleSave}
        />
      )}

      <MoyskladImportModal open={importOpen} onOpenChange={setImportOpen} onImported={load} />
    </div>
  );
}

function ProductCard({
  product,
  clickable,
  onClick,
}: {
  product: Product;
  clickable: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={cn(
        "group relative flex flex-col rounded-lg border border-[#e3e6eb] bg-white p-2.5 shadow-sm transition-all sm:p-3",
        clickable && "cursor-pointer hover:border-[#2563eb] hover:shadow-md active:scale-[0.98]",
      )}
    >
      {!product.active && (
        <span className="absolute top-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          Архив
        </span>
      )}
      <div className="mb-2 flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-[#f3f4f6]">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={200}
            height={200}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <ImageOff className="h-8 w-8 text-[#9ca3af]" />
        )}
      </div>
      <div className="line-clamp-2 min-h-[2.4em] text-xs font-semibold text-[#1f2328] sm:text-sm">
        {product.name}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6b7280]">
        {product.sku && <span className="font-mono">{product.sku}</span>}
        {product.externalSource === "moysklad" && (
          <span className="rounded bg-[#e0e7ff] px-1 py-0 text-[9px] font-bold text-[#3730a3]">
            moysklad
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between border-t border-[#e3e6eb] pt-2 text-xs">
        <div>
          <div className="text-[10px] text-[#6b7280]">Себестоимость</div>
          <div className="font-bold text-[#1f2328]">{formatCurrency(product.costPrice)}</div>
        </div>
        <div className="text-right">
          {(product.priceCount ?? 0) > 0 ? (
            <span className="font-bold text-[#2563eb]">
              {product.priceCount} прайс{product.priceCount === 1 ? "" : product.priceCount! > 4 ? "ов" : "а"}
            </span>
          ) : (
            <span className="font-bold text-[#d97706]">нет прайсов</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductFormModal({
  product,
  onClose,
  onSave,
}: {
  product: Product | null;
  onClose: () => void;
  onSave: (p: Product) => void | Promise<void>;
}) {
  const isEdit = !!product;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Product>(
    product ?? {
      id: 0,
      sku: "",
      name: "",
      imageUrl: "",
      costPrice: 0,
      unit: "шт",
      description: "",
      active: true,
      prices: [],
      priceCount: 0,
    },
  );

  const updatePrice = (marketplace: Marketplace, price: number) => {
    const prices = (form.prices ?? []).filter((p) => p.marketplace !== marketplace);
    if (price > 0) prices.push({ marketplace, price });
    setForm({ ...form, prices, priceCount: prices.length });
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Укажите название");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать товар" : "Новый товар"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Название *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>SKU (артикул)</Label>
              <Input value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Единица</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="шт" />
            </div>
            <div className="space-y-1.5">
              <Label>Себестоимость, ₽</Label>
              <Input
                type="number"
                min={0}
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-end gap-2">
              <Checkbox
                checked={form.active}
                onCheckedChange={(c) => setForm({ ...form, active: !!c })}
                id="active"
              />
              <Label htmlFor="active" className="cursor-pointer">
                Активен (показывать в пикере заказов)
              </Label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>URL картинки</Label>
              <Input
                value={form.imageUrl || ""}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://…"
              />
              {form.imageUrl && (
                <div className="mt-2 flex h-24 w-24 items-center justify-center overflow-hidden rounded border border-[#e3e6eb] bg-[#f3f4f6]">
                  <Image src={form.imageUrl} alt="" width={96} height={96} className="h-full w-full object-cover" unoptimized />
                </div>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Описание</Label>
              <Textarea
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>

          {/* Prices editor */}
          <div className="space-y-2 rounded-md border border-[#e3e6eb] bg-[#f9fafb] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
              Прайсы по площадкам
            </div>
            <p className="text-xs text-[#6b7280]">
              Цена для конкретного маркетплейса подставится в новый заказ автоматически. 0 = не продаётся на этой площадке.
            </p>
            {MARKETPLACES.map((m) => {
              const entry = (form.prices ?? []).find((p) => p.marketplace === m);
              return (
                <div key={m} className="flex items-center gap-2">
                  <div className="w-32 shrink-0 text-sm">{m}</div>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={entry?.price ?? ""}
                    onChange={(e) => updatePrice(m, Number(e.target.value))}
                    className="max-w-[140px]"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Сохраняем…" : isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoyskladImportModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void | Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleImport = async () => {
    if (!token.trim()) {
      toast.error("Введите токен МойСклад");
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const res = await api.post<{ created: number; updated: number; skipped: number; total: number }>(
        "/api/products/import/moysklad",
        { token: token.trim() },
      );
      setResult(
        `✓ Готово: ${res.created} новых, ${res.updated} обновлено` +
          (res.skipped ? `, ${res.skipped} пропущено` : "") +
          ` (всего получено ${res.total})`,
      );
      toast.success("Импорт завершён");
      await onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Импорт из МойСклад</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-[#6b7280]">
            Подтянет название, SKU, себестоимость и URL картинки. Существующие товары обновятся (привязка по external_id), новые — добавятся.
          </p>
          <div className="space-y-1.5">
            <Label>API-токен МойСклад</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer-токен"
              disabled={importing}
            />
            <p className="text-xs text-[#6b7280]">
              Получить можно в МойСклад → Настройки → Сервис → API.
            </p>
          </div>
          {result && (
            <div className="rounded-md bg-[#d1fae5] p-3 text-sm text-[#065f46]">{result}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Закрыть
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? "Импортируем…" : "Начать импорт"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
