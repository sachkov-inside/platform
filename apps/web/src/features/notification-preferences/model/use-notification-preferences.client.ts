"use client";
import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import {
  notificationPreferencesChanged,
  notificationPreferencesQueryOptions,
  notificationPreferencesQueryKey,
} from "./notification-preferences-query";

/**
 * Чтение настроек каналов для любой открытой поверхности. Кроме самого чтения оно слушает
 * сохранение с соседней поверхности и сбрасывает запомненный ответ в этот момент, а не ждёт
 * повторного открытия страницы.
 */
export function useNotificationPreferences() {
  const query = useQuery(notificationPreferencesQueryOptions());

  useAnnouncedRefresh(
    notificationPreferencesChanged,
    notificationPreferencesQueryKey,
  );

  return query;
}
