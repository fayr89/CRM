"use client";

import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/avatar";
import {
  mockDeals,
  mockUsers,
  formatCurrency,
  formatDate,
  stageLabels,
} from "@/lib/mock-data";
import {
  Plus,
  Search,
  Filter,
  MoreHorizontal,
  Building2,
  TrendingUp,
  Eye,
  Pencil,
  Trash2,
  ChevronDown,
} from "lucide-react";

export default function DealsPage() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  const stages = ["all", "new", "qualified", "proposal", "negotiation", "won", "lost"];

  const filteredDeals = mockDeals.filter((deal) => {
    const matchesSearch =
      deal.title.toLowerCase().includes(search.toLowerCase()) ||
      deal.companyName?.toLowerCase().includes(search.toLowerCase());
    const matchesStage = stageFilter === "all" || deal.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  const totalAmount = filteredDeals.reduce((sum, d) => sum + d.amount, 0);
  const weightedAmount = filteredDeals.reduce(
    (sum, d) => sum + (d.amount * d.probability) / 100,
    0
  );

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Сделки"
        subtitle={`${filteredDeals.length} сделок на ${formatCurrency(totalAmount)}`}
        action={
          <button className="h-9 px-3 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-semibold rounded-md transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Новая сделка</span>
          </button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <div className="bg-white rounded-lg p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#6b7280] uppercase">Всего</p>
          <p className="text-xl font-bold text-[#1f2328] mt-1">{filteredDeals.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#6b7280] uppercase">Сумма</p>
          <p className="text-xl font-bold text-[#1f2328] mt-1">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#6b7280] uppercase">Взвешенная</p>
          <p className="text-xl font-bold text-[#16a34a] mt-1">{formatCurrency(weightedAmount)}</p>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold text-[#6b7280] uppercase">Выиграно</p>
          <p className="text-xl font-bold text-[#1f2328] mt-1">
            {filteredDeals.filter((d) => d.stage === "won").length}
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mt-6 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
          <input
            type="text"
            placeholder="Поиск сделок..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 text-sm border border-[#e3e6eb] rounded-md focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent bg-white"
          />
        </div>
        <div className="flex gap-2">
          {/* Stage filter - desktop */}
          <div className="hidden md:flex items-center gap-1 bg-white border border-[#e3e6eb] rounded-md p-1">
            {stages.map((stage) => (
              <button
                key={stage}
                onClick={() => setStageFilter(stage)}
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                  stageFilter === stage
                    ? "bg-[#2563eb] text-white"
                    : "text-[#6b7280] hover:bg-[#f3f4f6]"
                }`}
              >
                {stage === "all" ? "Все" : stageLabels[stage]}
              </button>
            ))}
          </div>
          {/* Mobile filter button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="md:hidden h-10 px-3 border border-[#e3e6eb] rounded-md bg-white text-sm font-medium text-[#6b7280] flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Фильтры
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Mobile filters dropdown */}
      {showFilters && (
        <div className="md:hidden mt-2 p-3 bg-white rounded-lg border border-[#e3e6eb]">
          <p className="text-xs font-semibold text-[#6b7280] mb-2">Стадия</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((stage) => (
              <button
                key={stage}
                onClick={() => {
                  setStageFilter(stage);
                  setShowFilters(false);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                  stageFilter === stage
                    ? "bg-[#2563eb] text-white"
                    : "bg-[#f3f4f6] text-[#6b7280]"
                }`}
              >
                {stage === "all" ? "Все" : stageLabels[stage]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-4 bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e3e6eb]">
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Сделка
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Компания
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Сумма
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Стадия
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Вероятность
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Закрытие
                </th>
                <th className="text-left text-[11px] font-bold uppercase text-[#6b7280] px-4 py-3">
                  Ответственный
                </th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map((deal) => {
                const owner = mockUsers.find((u) => u.id === deal.ownerId);
                return (
                  <tr
                    key={deal.id}
                    className="border-b border-[#e3e6eb] last:border-0 hover:bg-[#f9fafb] transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-[#1f2328]">{deal.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#9ca3af]" />
                        <span className="text-sm text-[#6b7280]">{deal.companyName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-[#1f2328]">
                        {formatCurrency(deal.amount)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={deal.stage} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-[#e5e7eb] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#2563eb] rounded-full"
                            style={{ width: `${deal.probability}%` }}
                          />
                        </div>
                        <span className="text-xs text-[#6b7280]">{deal.probability}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-[#6b7280]">
                        {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {owner && (
                        <div className="flex items-center gap-2">
                          <UserAvatar name={owner.name} size="sm" />
                          <span className="text-sm text-[#6b7280]">{owner.name}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button className="p-1.5 hover:bg-[#f3f4f6] rounded transition-colors">
                        <MoreHorizontal className="w-4 h-4 text-[#9ca3af]" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-[#e3e6eb]">
          {filteredDeals.map((deal) => {
            const owner = mockUsers.find((u) => u.id === deal.ownerId);
            return (
              <div key={deal.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1f2328] truncate">{deal.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Building2 className="w-3.5 h-3.5 text-[#9ca3af]" />
                      <span className="text-xs text-[#6b7280]">{deal.companyName}</span>
                    </div>
                  </div>
                  <StatusBadge value={deal.stage} />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-lg font-bold text-[#1f2328]">
                    {formatCurrency(deal.amount)}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-[#6b7280]">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {deal.probability}%
                  </div>
                </div>
                {owner && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#e3e6eb]">
                    <UserAvatar name={owner.name} size="sm" />
                    <span className="text-xs text-[#6b7280]">{owner.name}</span>
                    {deal.expectedCloseDate && (
                      <>
                        <span className="text-[#d1d5db]">|</span>
                        <span className="text-xs text-[#6b7280]">
                          {formatDate(deal.expectedCloseDate)}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
