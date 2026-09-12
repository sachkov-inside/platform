import type { QueryClient } from "@tanstack/react-query";

import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";

import { readBillingContact } from "../api/billing-contact.browser";
import type { ReadContactResult } from "./billing-contact";

export const billingContactQueryKey = ["account", "billing-contact"] as const;

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
      state.data !== undefined && !state.data.ok && state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : (false as const),
  };
}

/** Забыть прежний ответ о контакте и перечитать его. Один жест для всех причин сброса. */
export function resetBillingContact(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: billingContactQueryKey });
}
