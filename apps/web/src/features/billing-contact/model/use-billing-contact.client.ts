"use client";
import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import {
  billingContactQueryOptions,
  billingContactVerified,
  billingContactQueryKey,
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
  const query = useQuery({ ...billingContactQueryOptions(), enabled });

  useAnnouncedRefresh(billingContactVerified, billingContactQueryKey);

  return query;
}
