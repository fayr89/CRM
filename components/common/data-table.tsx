"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { Search, Plus, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";

export interface Column<T> {
  key: string;
  label: string;
  // Для десктопной таблицы
  render?: (row: T) => React.ReactNode;
  // Для мобильной карточки: primary/secondary/badge/right
  mobile?: "primary" | "secondary" | "badge" | "right" | "hidden";
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchKeys?: (keyof T)[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  toolbar?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  getRowKey?: (row: T) => string | number;
}

export function DataTable<T extends { id: number | string }>({
  data,
  columns,
  searchKeys,
  searchPlaceholder = "Поиск…",
  onRowClick,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  toolbar,
  rowActions,
  getRowKey,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim() || !searchKeys) return data;
    const q = search.trim().toLowerCase();
    return data.filter((row) =>
      searchKeys.some((k) => {
        const v = row[k];
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [data, search, searchKeys]);

  const key = (row: T) => (getRowKey ? getRowKey(row) : row.id);

  const getCell = (row: T, col: Column<T>) =>
    col.render ? col.render(row) : (row as never)[col.key];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {searchKeys && (
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        <div className="flex-1" />
        {toolbar}
      </div>

      {/* Empty */}
      {filtered.length === 0 && (
        <EmptyState
          icon={emptyIcon}
          title={search ? "Ничего не найдено" : emptyTitle}
          description={
            search ? `По запросу «${search}» совпадений нет.` : emptyDescription
          }
        />
      )}

      {/* Mobile cards */}
      {filtered.length > 0 && (
        <div className="space-y-2 md:hidden">
          {filtered.map((row) => {
            const primary = columns.find((c) => c.mobile === "primary");
            const secondaryCols = columns.filter((c) => c.mobile === "secondary");
            const badge = columns.find((c) => c.mobile === "badge");
            const right = columns.find((c) => c.mobile === "right");
            return (
              <div
                key={key(row)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "rounded-lg border border-[#e3e6eb] bg-white p-3 shadow-sm",
                  onRowClick && "cursor-pointer active:bg-[#f9fafb]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {primary && (
                      <div className="truncate text-sm font-semibold text-[#1f2328]">
                        {getCell(row, primary)}
                      </div>
                    )}
                    {secondaryCols.map((c) => (
                      <div key={c.key} className="mt-0.5 truncate text-xs text-[#6b7280]">
                        {getCell(row, c)}
                      </div>
                    ))}
                    {badge && <div className="mt-1.5">{getCell(row, badge)}</div>}
                  </div>
                  {right && (
                    <div className="shrink-0 text-right text-sm font-bold text-[#1f2328]">
                      {getCell(row, right)}
                    </div>
                  )}
                </div>
                {rowActions && (
                  <div
                    className="mt-2 flex flex-wrap justify-end gap-1 border-t border-[#e3e6eb] pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions(row)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop table */}
      {filtered.length > 0 && (
        <div className="hidden overflow-hidden rounded-lg border border-[#e3e6eb] bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e3e6eb] bg-[#f9fafb]">
                  {columns
                    .filter((c) => c.mobile !== "hidden")
                    .map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]",
                          c.className,
                        )}
                      >
                        {c.label}
                      </th>
                    ))}
                  {rowActions && (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                      Действия
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e6eb]">
                {filtered.map((row) => (
                  <tr
                    key={key(row)}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      "transition-colors",
                      onRowClick && "cursor-pointer hover:bg-[#f9fafb]",
                    )}
                  >
                    {columns
                      .filter((c) => c.mobile !== "hidden")
                      .map((c) => (
                        <td
                          key={c.key}
                          className={cn("px-4 py-3 text-sm text-[#1f2328]", c.className)}
                        >
                          {getCell(row, c)}
                        </td>
                      ))}
                    {rowActions && (
                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {rowActions(row)}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Удобный хелпер для кнопки в toolbar
export function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button onClick={onClick}>
      <Plus className="mr-2 h-4 w-4" />
      {children}
    </Button>
  );
}
