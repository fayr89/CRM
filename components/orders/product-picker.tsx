"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Search, Package } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { mockProducts } from "@/lib/mock-data";
import type { Product, Marketplace } from "@/lib/types";

interface ProductPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketplace: Marketplace;
  onSelect: (product: Product) => void;
}

export function ProductPicker({ open, onOpenChange, marketplace, onSelect }: ProductPickerProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const q = search.trim().toLowerCase();
    const filtered = mockProducts
      .filter((p) => p.active)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)),
      )
      .slice(0, 100);
    setResults(filtered);
  }, [search, open]);

  const getPrice = (p: Product): number | null => {
    const entry = p.prices?.find((pp) => pp.marketplace === marketplace);
    return entry?.price ?? null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 sm:p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-[#e3e6eb] p-4">
          <DialogTitle className="flex items-center gap-2">
            Выбор товара
            {marketplace && (
              <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-semibold text-[#1e40af]">
                {marketplace}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="border-b border-[#e3e6eb] p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
            <Input
              placeholder="Поиск по названию или артикулу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1 sm:max-h-[50vh]">
          {results.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#6b7280]">
              {search ? "Ничего не найдено" : "В каталоге пусто. Добавьте товар в разделе «Каталог»."}
            </div>
          ) : (
            <ul className="divide-y divide-[#e3e6eb]">
              {results.map((p) => {
                const price = getPrice(p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(p);
                        onOpenChange(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#eff6ff] active:bg-[#dbeafe]"
                    >
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-[#f3f4f6]">
                        {p.imageUrl ? (
                          <Image src={p.imageUrl} alt="" width={48} height={48} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          <Package className="h-5 w-5 text-[#9ca3af]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{p.name}</div>
                        <div className="text-xs text-[#6b7280]">
                          {p.sku ? `Арт: ${p.sku}` : "Без артикула"} · себестоимость{" "}
                          {p.costPrice.toLocaleString("ru-RU")} ₽
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {price !== null ? (
                          <span className="text-sm font-bold text-[#2563eb]">
                            {price.toLocaleString("ru-RU")} ₽
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-[#d97706]">нет в прайсе</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
