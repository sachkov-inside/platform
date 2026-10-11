"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { subscribeToCurrentBillingChanges } from "@/features/billing-subscription";
import { readingProgressChanges } from "@/features/reading-progress";

/**
 * Кеш маршрутов держит личную часть страницы 60 секунд (ADR 0027), а смена доступа ждать не должна.
 * Вход, выход и возврат из банка — полные загрузки документа и сбрасывают кеш сами. Здесь закрыто
 * остальное: аккаунт сменился в другой вкладке, состояние покупателя или прогресс объявлены изменёнными —
 * `router.refresh()` забывает сохранённые страницы и перечитывает текущую.
 */
export function useAccessChangeRefresh(
  accountId: string | null,
  authResolved: boolean,
): void {
  const router = useRouter();
  const previousAccount = useRef<string | null | undefined>(undefined);

  useEffect(
    () =>
      subscribeToCurrentBillingChanges(() => {
        router.refresh();
      }),
    [router],
  );

  useEffect(() => {
    if (!authResolved || accountId === null) return;
    return readingProgressChanges(accountId).subscribe(() => {
      router.refresh();
    });
  }, [accountId, authResolved, router]);

  useEffect(() => {
    if (!authResolved) return;
    if (
      previousAccount.current !== undefined &&
      previousAccount.current !== accountId
    ) {
      router.refresh();
    }
    previousAccount.current = accountId;
  }, [accountId, authResolved, router]);
}
