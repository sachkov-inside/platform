import { readCurrentBilling } from "../api/billing-subscription.browser";

export const currentBillingQueryKey = ["account", "billing"] as const;

/**
 * Один владелец состояния billing в браузере: разделы кабинета читают тот же ключ, поэтому
 * боковая навигация и панели не расходятся между собой.
 */
export function currentBillingQueryOptions() {
  return {
    queryKey: currentBillingQueryKey,
    queryFn: readCurrentBilling,
    retry: false,
    staleTime: 0,
  };
}
