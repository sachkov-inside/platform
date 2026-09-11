import { readNotificationPreferences } from "../api/notification-preferences.browser";

export const notificationPreferencesQueryKey = [
  "account",
  "notification-preferences",
] as const;

/** Один владелец настроек каналов в браузере: раздел читает и пишет тот же ключ. */
export function notificationPreferencesQueryOptions() {
  return {
    queryKey: notificationPreferencesQueryKey,
    queryFn: readNotificationPreferences,
    retry: false,
    staleTime: 0,
  };
}
