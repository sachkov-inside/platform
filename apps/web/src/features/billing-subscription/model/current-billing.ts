import type { QueryClient } from "@tanstack/react-query";

import { factAnnouncement } from "@/shared/api/fact-announcement";
import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";
import type {
  BillingCommandResult,
  CurrentBilling,
} from "@/entities/subscription";

import { readCurrentBilling } from "../api/billing-subscription.browser";

export const currentBillingQueryKey = ["account", "billing"] as const;

/** Каждая команда, изменившая состояние покупателя, объявляется всем открытым поверхностям. */
export const currentBillingChanged = factAnnouncement(
  "inside.account.billing.changed",
);

/**
 * Подписка для поверхностей вне billing: состояние покупателя решает, что человеку открыто, поэтому
 * оболочка по этому объявлению сбрасывает кеш маршрутов (ADR 0027).
 */
export const subscribeToCurrentBillingChanges = currentBillingChanged.subscribe;

/**
 * Пока у банка есть незавершённая операция, её исход приходит сам: раздел перечитывает
 * состояние по интервалу, а не ждёт действия владельца аккаунта.
 */
function billingRefreshInterval(
  result: BillingCommandResult<CurrentBilling> | undefined,
): number | false {
  if (result === undefined) return false;
  if (!result.ok)
    return result.code === "unauthorized" ? false : unavailableRetryIntervalMs;
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

/**
 * Забыть прежний ответ о состоянии покупателя и перечитать его. Начатое перечитывание не
 * отменяется: сколько бы поверхностей одной вкладки ни услышало объявление, чтение одно.
 */
export function resetCurrentBilling(client: QueryClient): Promise<void> {
  return client.invalidateQueries(
    { queryKey: currentBillingQueryKey },
    { cancelRefetch: false },
  );
}
