import type { QueryClient } from "@tanstack/react-query";

import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";

import { readBillingContact } from "../api/billing-contact.browser";
import type { ReadContactResult } from "./billing-contact";

export const billingContactQueryKey = ["account", "billing-contact"] as const;

/** Подтверждение адреса объявляется всем открытым поверхностям одного браузера. */
export const billingContactVerified = factAnnouncement(
  "inside.billing-contact.verified",
);

/**
 * Один владелец чтения контакта в браузере: разделы кабинета, витрина и форма читают тот же
 * ключ, поэтому подтверждённый адрес не расходится между ними.
 */
export function billingContactQueryOptions() {
  return {
    ...selfRefreshingRead,
    queryKey: billingContactQueryKey,
    queryFn: readBillingContact,
    refetchInterval: ({
      state,
    }: {
      readonly state: { readonly data: ReadContactResult | undefined };
    }) =>
      state.data !== undefined &&
      !state.data.ok &&
      state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : (false as const),
  };
}

/** Перечитать после записи, отменив старый ответ; все слушатели одной записи делят чтение (#2268). */
export function resetBillingContact(
  client: QueryClient,
  announcementId: string,
): Promise<void> {
  return refreshAnnouncedQueries(
    client,
    billingContactQueryKey,
    announcementId,
  );
}
