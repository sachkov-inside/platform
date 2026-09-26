import type { QueryClient } from "@tanstack/react-query";

import { factAnnouncement } from "@/shared/api/fact-announcement";
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

/** Сохранённый выбор каналов объявляется всем открытым поверхностям одного браузера. */
export const notificationPreferencesChanged = factAnnouncement(
  "inside.account.notification-preferences.changed",
);

/**
 * Забыть прежний ответ о настройках и перечитать его. Начатое перечитывание не отменяется, поэтому
 * повторный сброс присоединяется к нему, а не начинает новый запрос.
 */
export function resetNotificationPreferences(
  client: QueryClient,
): Promise<void> {
  return client.invalidateQueries(
    { queryKey: notificationPreferencesQueryKey },
    { cancelRefetch: false },
  );
}

/** Один владелец настроек каналов в браузере: раздел читает и пишет тот же ключ. */
export function notificationPreferencesQueryOptions() {
  return {
    ...selfRefreshingRead,
    queryKey: notificationPreferencesQueryKey,
    queryFn: readNotificationPreferences,
    refetchInterval: ({
      state,
    }: {
      readonly state: {
        readonly data: NotificationPreferencesResult | undefined;
      };
    }) =>
      state.data !== undefined &&
      !state.data.ok &&
      state.data.code !== "unauthorized"
        ? unavailableRetryIntervalMs
        : (false as const),
  };
}
