"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import confetti from "canvas-confetti";
import type { Deal } from "@/lib/types";
import { StageColumn } from "./stage-column";
import { DealCard } from "./deal-card";
import { toast } from "sonner";

interface KanbanBoardProps {
  deals: Deal[];
  stages: string[];
  stageLabels: Record<string, string>;
  onDealMove: (dealId: number, newStage: string) => void;
}

export function KanbanBoard({ deals, stages, stageLabels, onDealMove }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<number | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeDeal = activeId ? deals.find(d => d.id === activeId) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const dealId = active.id as number;
    const newStage = over.id as string;
    const deal = deals.find(d => d.id === dealId);

    if (!deal || deal.stage === newStage) return;

    // Check if moving to won - trigger confetti
    if (newStage === 'won') {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      toast.success('Поздравляем! Сделка выиграна!');
    }

    // Check if moving to lost - show reason prompt
    if (newStage === 'lost') {
      const reason = window.prompt('Укажите причину проигрыша:');
      if (reason === null) return; // User cancelled
      toast.info(`Сделка помечена как проигранная${reason ? `: ${reason}` : ''}`);
    }

    onDealMove(dealId, newStage);
  }, [deals, onDealMove]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory lg:snap-none">
        {stages.map(stage => {
          const stageDeals = deals.filter(d => d.stage === stage);
          const totalAmount = stageDeals.reduce((sum, d) => sum + d.amount, 0);
          
          return (
            <StageColumn
              key={stage}
              id={stage}
              title={stageLabels[stage]}
              count={stageDeals.length}
              totalAmount={totalAmount}
              deals={stageDeals}
              isActive={activeId !== null}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeDeal ? (
          <DealCard deal={activeDeal} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
