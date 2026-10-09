"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  billingContactQueryOptions,
  billingContactVerified,
  resetBillingContact,
} from "./billing-contact-query";

/**
 * Чтение подтверждённого контакта для любой поверхности. Кроме самого чтения оно слушает
 * подтверждение с соседней поверхности и сбрасывает запомненный ответ в этот момент, а не ждёт
 * повторного открытия страницы.
 */
export function useBillingContact({
  enabled = true,
}: {
  /** `false` — сервер уже знает, что человек не вошёл: контакт читать незачем. */
  readonly enabled?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({ ...billingContactQueryOptions(), enabled });

  useEffect(
    () =>
      billingContactVerified.subscribe(() => {
        void resetBillingContact(queryClient);
      }),
    [queryClient],
  );

  return query;
}
