"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  currentBillingChanged,
  currentBillingQueryOptions,
  resetCurrentBilling,
} from "./current-billing";

/**
 * Чтение состояния покупателя для любой поверхности: разделы кабинета, его рамка и обе витрины.
 * Кроме самого чтения оно слушает команды с соседней поверхности и сбрасывает запомненный ответ в
 * этот момент, а не ждёт повторного открытия страницы.
 */
export function useCurrentBilling() {
  const queryClient = useQueryClient();
  const query = useQuery(currentBillingQueryOptions());

  useEffect(
    () =>
      currentBillingChanged.subscribe(() => {
        void resetCurrentBilling(queryClient);
      }),
    [queryClient],
  );

  return query;
}
