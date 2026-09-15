"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  notificationPreferencesChanged,
  notificationPreferencesQueryOptions,
  resetNotificationPreferences,
} from "./notification-preferences-query";

/**
 * Чтение настроек каналов для любой открытой поверхности. Кроме самого чтения оно слушает
 * сохранение с соседней поверхности и сбрасывает запомненный ответ в этот момент, а не ждёт
 * повторного открытия страницы.
 */
export function useNotificationPreferences() {
  const queryClient = useQueryClient();
  const query = useQuery(notificationPreferencesQueryOptions());

  useEffect(
    () =>
      notificationPreferencesChanged.subscribe(() => {
        void resetNotificationPreferences(queryClient);
      }),
    [queryClient],
  );

  return query;
}
