"use client";
import { useRef } from "react";

/**
 * Ссылка на операцию живёт, пока не изменилась её нагрузка: повтор того же действия
 * присоединяется к начатой операции, а изменённая нагрузка получает новую ссылку.
 */
export function useBillingOperations(): (slot: string, payload: unknown) => string {
  const slots = useRef(new Map<string, { key: string; id: string }>());
  return (slot, payload) => {
    const key = JSON.stringify(payload);
    const current = slots.current.get(slot);
    if (current !== undefined && current.key === key) return current.id;
    const next = { key, id: crypto.randomUUID() };
    slots.current.set(slot, next);
    return next.id;
  };
}
