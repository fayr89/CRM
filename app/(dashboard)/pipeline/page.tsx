"use client";

import { useState } from "react";
import { mockDeals, formatCurrency, stageLabels } from "@/lib/mock-data";
import type { Deal } from "@/lib/types";
import { PageHeader } from "@/components/common/page-header";
import { HelpBanner } from "@/components/common/help-banner";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;

export default function PipelinePage() {
  const [deals, setDeals] = useState<Deal[]>(mockDeals);
  const [showHelp, setShowHelp] = useState(true);

  const handleDealMove = (dealId: number, newStage: string) => {
    setDeals(prev => 
      prev.map(deal => 
        deal.id === dealId 
          ? { ...deal, stage: newStage as Deal['stage'], probability: getProbabilityForStage(newStage) }
          : deal
      )
    );
  };

  const getProbabilityForStage = (stage: string): number => {
    const probabilities: Record<string, number> = {
      new: 10,
      qualified: 30,
      proposal: 50,
      negotiation: 70,
      won: 100,
      lost: 0,
    };
    return probabilities[stage] || 0;
  };

  // Calculate totals
  const pipelineDeals = deals.filter(d => !['won', 'lost'].includes(d.stage));
  const pipelineTotal = pipelineDeals.reduce((sum, d) => sum + d.amount, 0);
  const weightedPipeline = pipelineDeals.reduce((sum, d) => sum + (d.amount * d.probability / 100), 0);

  return (
    <div className="space-y-4">
      <PageHeader 
        title="Воронка продаж"
        action={
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Новая сделка
          </Button>
        }
      />

      {showHelp && (
        <HelpBanner onDismiss={() => setShowHelp(false)}>
          Перетаскивайте карточки между колонками, чтобы менять стадию сделки. Клик по карточке — открыть детали.
        </HelpBanner>
      )}

      <KanbanBoard 
        deals={deals}
        stages={stages as unknown as string[]}
        stageLabels={stageLabels}
        onDealMove={handleDealMove}
      />

      {/* Summary */}
      <div className="bg-white rounded-lg border border-[#e3e6eb] p-4 shadow-sm">
        <div className="flex items-center gap-6 text-sm">
          <span className="text-[#6b7280]">
            Сумма воронки: <span className="font-semibold text-[#1f2328]">{formatCurrency(pipelineTotal)}</span>
          </span>
          <span className="text-[#6b7280]">
            Взвешенная: <span className="font-semibold text-[#1f2328]">{formatCurrency(weightedPipeline)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
