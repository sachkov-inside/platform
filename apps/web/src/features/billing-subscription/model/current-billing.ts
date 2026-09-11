import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";
import type { BillingCommandResult, CurrentBilling } from "@/entities/subscription";

import { readCurrentBilling } from "../api/billing-subscription.browser";

export const currentBillingQueryKey = ["account", "billing"] as const;

/**
 * Пока у банка есть незавершённая операция, её исход приходит сам: раздел перечитывает
 * состояние по интервалу, а не ждёт действия владельца аккаунта.
 */
function billingRefreshInterval(
  result: BillingCommandResult<CurrentBilling> | undefined,
): number | false {
  if (result === undefined) return false;
  if (!result.ok) return result.code === "unauthorized" ? false : unavailableRetryIntervalMs;
  const subscription = result.value.subscription;
  if (subscription === null) return false;
  return subscription.inFlightPayment !== null ||
    subscription.pendingMethodChange !== null
    ? unavailableRetryIntervalMs
    : false;
}

/**
 * Один владелец состояния billing в браузере: разделы кабинета читают тот же ключ, поэтому
 * боковая навигация и панели не расходятся между собой.
 */
export function currentBillingQueryOptions() {
  return {
    ...selfRefreshingRead,
    queryKey: currentBillingQueryKey,
    queryFn: readCurrentBilling,
    refetchInterval: ({
      state,
    }: {
      readonly state: {
        readonly data: BillingCommandResult<CurrentBilling> | undefined;
      };
    }) => billingRefreshInterval(state.data),
  };
}
