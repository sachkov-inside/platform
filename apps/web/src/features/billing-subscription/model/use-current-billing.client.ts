"use client";
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import {
  subscribeToCurrentBillingChanges,
  currentBillingQueryOptions,
  currentBillingQueryKey,
} from "./current-billing";

const billingAnnouncements = { subscribe: subscribeToCurrentBillingChanges };

const subscribeToHydration = () => () => undefined;
const readClientHydration = () => true;
const readServerHydration = () => false;

/**
 * Чтение состояния покупателя для любой поверхности: разделы кабинета, его рамка и обе витрины.
 * Кроме самого чтения оно слушает команды с соседней поверхности и сбрасывает запомненный ответ в
 * этот момент, а не ждёт повторного открытия страницы.
 */
export function useCurrentBilling({
  enabled = true,
}: {
  /** `false` — сервер уже знает, что человек не вошёл: читать нечего, и запрос не уходит. */
  readonly enabled?: boolean;
} = {}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    readClientHydration,
    readServerHydration,
  );
  const query = useQuery({ ...currentBillingQueryOptions(), enabled });

  useAnnouncedRefresh(billingAnnouncements, currentBillingQueryKey);

  // Рамка кабинета может прочитать billing раньше гидратации вложенной панели. Её первый
  // рендер всё равно повторяет пустой серверный снимок; затем она видит общий кеш без нового чтения.
  return {
    ...query,
    data: hydrated ? query.data : undefined,
    isPending: !hydrated || query.isPending,
  };
}
