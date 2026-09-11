import {
  selfRefreshingRead,
  unavailableRetryIntervalMs,
} from "@/shared/api/self-refreshing-query";

import { readNotificationPreferences } from "../api/notification-preferences.browser";
import type { NotificationPreferencesResult } from "./notification-preferences";

export const notificationPreferencesQueryKey = [
  "account",
  "notification-preferences",
] as const;

/** Один владелец настроек каналов в браузере: раздел читает и пишет тот же ключ. */
export function notificationPreferencesQueryOptions() {
  return {
    ...selfRefreshingRead,
    queryKey: notificationPreferencesQueryKey,
    queryFn: readNotificationPreferences,
    refetchInterval: ({
      state,
    }: {
      readonly state: { readonly data: NotificationPreferencesResult | undefined };
    }) =>
      state.data !== undefined &&
      !state.data.ok &&
      state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : (false as const),
  };
}
