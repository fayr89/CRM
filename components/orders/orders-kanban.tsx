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
import type { Order } from "@/lib/types";
import { mockCurrentUser, orderStatusLabels } from "@/lib/mock-data";
import { OrderColumn } from "./order-column";
import { OrderCard } from "./order-card";
import { toast } from "sonner";

interface OrdersKanbanProps {
  orders: Order[];
  onOrderMove: (orderId: number, newStatus: string) => void;
}

const statuses = ['new', 'reserved', 'shipped', 'completed', 'cancelled'] as const;

// Valid transitions based on role
const validTransitions: Record<string, Record<string, string[]>> = {
  warehouse: {
    new: ['reserved', 'cancelled'],
    reserved: ['shipped', 'cancelled'],
    shipped: ['cancelled'],
  },
  admin: {
    new: ['reserved', 'cancelled'],
    reserved: ['shipped', 'cancelled'],
    shipped: ['completed', 'cancelled'],
    completed: ['cancelled'],
  },
  manager: {
    new: ['cancelled'],
    reserved: ['cancelled'],
    shipped: ['completed', 'cancelled'],
  },
  sales: {
    new: ['cancelled'],
    shipped: ['completed', 'cancelled'],
  },
};

export function OrdersKanban({ orders, onOrderMove }: OrdersKanbanProps) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const user = mockCurrentUser;
  
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

  const activeOrder = activeId ? orders.find(o => o.id === activeId) : null;

  const canTransition = (fromStatus: string, toStatus: string): boolean => {
    const roleTransitions = validTransitions[user.role];
    if (!roleTransitions) return false;
    return roleTransitions[fromStatus]?.includes(toStatus) || false;
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const orderId = active.id as number;
    const newStatus = over.id as string;
    const order = orders.find(o => o.id === orderId);

    if (!order || order.status === newStatus) return;

    // Check if transition is valid
    if (!canTransition(order.status, newStatus)) {
      toast.error(`Нельзя перевести из «${orderStatusLabels[order.status]}» в «${orderStatusLabels[newStatus]}»`);
      return;
    }

    // Handle cancel with reason
    if (newStatus === 'cancelled') {
      const reason = window.prompt('Укажите причину отмены:');
      if (reason === null) return;
      toast.info(`Заказ #${orderId} отменён`);
    } else {
      toast.success(`Заказ #${orderId} переведён в статус «${orderStatusLabels[newStatus]}»`);
    }

    onOrderMove(orderId, newStatus);
  }, [orders, onOrderMove, user.role]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory lg:snap-none">
        {statuses.map(status => {
          const statusOrders = orders.filter(o => o.status === status);
          
          return (
            <OrderColumn
              key={status}
              id={status}
              title={orderStatusLabels[status]}
              count={statusOrders.length}
              orders={statusOrders}
              isActive={activeId !== null}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeOrder ? (
          <OrderCard order={activeOrder} isDragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
