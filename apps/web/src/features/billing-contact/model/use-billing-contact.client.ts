"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  billingContactQueryOptions,
  resetBillingContact,
} from "./billing-contact-query";
import { subscribeBillingContactVerified } from "./billing-contact-verified-channel";

/**
 * Чтение подтверждённого контакта для любой поверхности. Кроме самого чтения оно слушает
 * подтверждение с соседней поверхности и сбрасывает запомненный ответ в этот момент, а не ждёт
 * повторного открытия страницы.
 */
export function useBillingContact() {
  const queryClient = useQueryClient();
  const query = useQuery(billingContactQueryOptions());

  useEffect(
    () =>
      subscribeBillingContactVerified(() => {
        void resetBillingContact(queryClient);
      }),
    [queryClient],
  );

  return query;
}
