"use client";
import { useState } from "react";

export interface BillingOperations {
  /** Ссылка на операцию живёт, пока не изменилась её нагрузка: повтор присоединяется к начатой. */
  readonly operationId: (slot: string, payload: unknown) => string;
  /**
   * Операция завершилась. Следующая попытка того же действия с той же нагрузкой — это новая
   * операция: иначе сервер вернул бы прежний результат вместо нового письма или расчёта.
   */
  readonly completeOperation: (slot: string) => void;
}

/** Чистые правила ссылок на операции: их проверяет `billing-operations.test.ts`. */
export function createBillingOperations(): BillingOperations {
  const slots = new Map<string, { key: string; id: string }>();
  return {
    operationId: (slot, payload) => {
      const key = JSON.stringify(payload);
      const current = slots.get(slot);
      if (current !== undefined && current.key === key) return current.id;
      const next = { key, id: crypto.randomUUID() };
      slots.set(slot, next);
      return next.id;
    },
    completeOperation: (slot) => {
      slots.delete(slot);
    },
  };
}

export function useBillingOperations(): BillingOperations {
  const [operations] = useState(createBillingOperations);
  return operations;
}
