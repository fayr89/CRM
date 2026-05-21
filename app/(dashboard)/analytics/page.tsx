"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { TrendingUp, BarChart3, Package, Users, Globe } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  mockCurrentUser,
  mockAnalyticsRevenue,
  mockAnalyticsManagers,
  mockAnalyticsMarketplaces,
  mockAnalyticsTopProducts,
  mockAnalyticsSummary,
  formatCurrency,
  roleLabels,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function AnalyticsPage() {
  const me = mockCurrentUser;
  const isAllowed = me.role === "admin" || me.role === "manager";

  const [period, setPeriod] = useState<"7" | "30" | "90" | "365">("30");

  if (!isAllowed) {
    return (
      <div className="rounded-lg border border-dashed border-[#e3e6eb] bg-white p-8 text-center">
        <h3 className="text-base font-semibold text-[#1f2328]">Раздел недоступен</h3>
        <p className="mt-2 text-sm text-[#6b7280]">
          Аналитика доступна только администраторам и менеджерам.
        </p>
      </div>
    );
  }

  // На реальном API: api.analyticsSummary(period) и т.д. Сейчас — mock.
  const s = mockAnalyticsSummary;
  const revenue = mockAnalyticsRevenue;
  const managers = mockAnalyticsManagers;
  const marketplaces = mockAnalyticsMarketplaces;
  const topProducts = mockAnalyticsTopProducts;

  const maxRevenue = useMemo(() => Math.max(...revenue.map((p) => p.revenue), 1), [revenue]);
  const maxManagerRevenue = useMemo(() => Math.max(...managers.map((m) => m.revenue), 1), [managers]);
  const maxMarketplaceRevenue = useMemo(
    () => Math.max(...marketplaces.map((m) => m.revenue), 1),
    [marketplaces],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Аналитика"
        subtitle="Сводка для руководства — выручка, лидеры, площадки, товары."
        action={
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">За 7 дней</SelectItem>
              <SelectItem value="30">За 30 дней</SelectItem>
              <SelectItem value="90">За 90 дней</SelectItem>
              <SelectItem value="365">За год</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* Summary */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#6b7280]">Сводка</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Выручка"
            value={formatCurrency(s.revenue.total)}
            sub={`${s.revenue.completedOrders} заказов`}
          />
          <StatCard label="Средний чек" value={formatCurrency(s.revenue.avgOrderValue)} />
          <StatCard
            label="Сделки выиграны"
            value={s.deals.won}
            sub={`Win rate: ${(s.deals.winRate * 100).toFixed(0)}%`}
          />
          <StatCard
            label="Открытые сделки"
            value={s.deals.open}
            sub={`На ${formatCurrency(s.deals.wonAmount)}`}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Новые лиды" value={s.customers.newLeads} />
          <StatCard label="Новые контакты" value={s.customers.newContacts} />
          <StatCard label="Новые компании" value={s.customers.newCompanies} />
          <StatCard
            label="Заказы"
            value={s.orders.newOrders + s.orders.reservedOrders + s.orders.shippedOrders}
            sub={`${s.orders.reservedOrders} зарез. · ${s.orders.shippedOrders} отгр.`}
          />
        </div>
      </section>

      {/* Revenue chart */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">
          <TrendingUp className="h-4 w-4" />
          Выручка по дням
        </h3>
        <div className="rounded-lg border border-[#e3e6eb] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex h-44 items-end gap-1 border-b border-[#e3e6eb] pb-1 sm:gap-1.5">
            {revenue.map((p) => {
              const h = Math.max(2, Math.round((p.revenue / maxRevenue) * 100));
              return (
                <div
                  key={p.date}
                  className="group relative flex flex-1 flex-col justify-end"
                  title={`${p.date}: ${formatCurrency(p.revenue)}`}
                >
                  <div
                    className="rounded-t bg-gradient-to-t from-[#1d4ed8] to-[#2563eb] transition-opacity hover:opacity-80"
                    style={{ height: `${h}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-[#6b7280]">
            <span>{revenue[0]?.date}</span>
            <span>{revenue[revenue.length - 1]?.date}</span>
          </div>
        </div>
      </section>

      {/* Managers leaderboard */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">
          <Users className="h-4 w-4" />
          Топ менеджеров
        </h3>
        <div className="rounded-lg border border-[#e3e6eb] bg-white shadow-sm">
          {managers.map((u, idx) => (
            <div
              key={u.id}
              className={cn(
                "grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_2fr_140px] sm:items-center sm:gap-4",
                idx < managers.length - 1 && "border-b border-[#e3e6eb]",
              )}
            >
              <div>
                <div className="font-semibold">{u.name}</div>
                <div className="text-xs text-[#6b7280]">{roleLabels[u.role]}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f3f4f6] sm:h-2.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#1d4ed8]"
                  style={{ width: `${(u.revenue / maxManagerRevenue) * 100}%` }}
                />
              </div>
              <div className="text-left sm:text-right">
                <div className="font-bold">{formatCurrency(u.revenue)}</div>
                <div className="text-xs text-[#6b7280]">
                  {u.ordersCount} заказов · {u.dealsWon} сделок
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Marketplaces */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">
          <Globe className="h-4 w-4" />
          Выручка по площадкам
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {marketplaces.map((m) => (
            <div
              key={m.marketplace}
              className="rounded-lg border border-[#e3e6eb] bg-white p-3 shadow-sm"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
                {m.marketplace}
              </div>
              <div className="mt-1 text-lg font-bold">{formatCurrency(m.revenue)}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f3f4f6]">
                <div
                  className="h-full bg-[#2563eb]"
                  style={{ width: `${(m.revenue / maxMarketplaceRevenue) * 100}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-[#6b7280]">
                {m.ordersCount} заказов · ср. чек {formatCurrency(m.avgOrderValue)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top products */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6b7280]">
          <Package className="h-4 w-4" />
          Топ товаров
        </h3>
        <div className="overflow-hidden rounded-lg border border-[#e3e6eb] bg-white shadow-sm">
          {/* Mobile cards */}
          <div className="divide-y divide-[#e3e6eb] md:hidden">
            {topProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3">
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
                    {p.unitsSold} шт · {formatCurrency(p.revenue)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-[#16a34a]">+{formatCurrency(p.profit)}</div>
                  <div className="text-[10px] text-[#6b7280]">прибыль</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e3e6eb] bg-[#f9fafb]">
                <tr>
                  <th className="w-12 px-4 py-3"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Товар</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Артикул</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Продано</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Выручка</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Прибыль</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e6eb]">
                {topProducts.map((p) => (
                  <tr key={p.id} className="hover:bg-[#f9fafb]">
                    <td className="px-4 py-3">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#f3f4f6]">
                        {p.imageUrl ? (
                          <Image src={p.imageUrl} alt="" width={40} height={40} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          <Package className="h-4 w-4 text-[#9ca3af]" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    <td className="px-4 py-3 text-xs text-[#6b7280]">{p.sku || "—"}</td>
                    <td className="px-4 py-3 text-right">{p.unitsSold} шт</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(p.revenue)}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "font-bold",
                          p.profit >= 0 ? "text-[#16a34a]" : "text-[#dc2626]",
                        )}
                      >
                        {p.profit >= 0 ? "+" : ""}
                        {formatCurrency(p.profit)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
