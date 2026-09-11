"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  billingErrorMessage,
  type BillingCommandResult,
  type BillingFailureCode,
  type CurrentBilling,
  type SubscriptionView,
} from "@/entities/subscription";

import {
  currentBillingQueryKey,
  currentBillingQueryOptions,
} from "./current-billing";

export interface BillingCabinet {
  readonly billing: CurrentBilling | null;
  readonly subscription: SubscriptionView | null;
  readonly loading: boolean;
  readonly sessionExpired: boolean;
  readonly error: string | undefined;
  readonly setError: (message: string | undefined) => void;
  /** Каждая команда возвращает новую revision, и она же становится ожидаемой для следующей. */
  readonly applySubscription: (value: SubscriptionView) => void;
  readonly fail: (code: BillingFailureCode) => void;
  readonly refresh: () => void;
  /**
   * Исход команды разбирается одинаково: ожидаемая ошибка объясняется словами и перечитывает
   * состояние, успех продолжает работу раздела.
   */
  readonly settle: <Value>(
    result: BillingCommandResult<Value>,
    onSuccess: (value: Value) => void,
    onFailure?: (code: BillingFailureCode) => void,
  ) => void;
}

/**
 * Разделы «Покупки» и «Подписка» живут на разных маршрутах, но отвечают об одном состоянии:
 * чтение, ожидаемая revision и разбор исхода принадлежат одному месту.
 */
export function useBillingCabinet(): BillingCabinet {
  const queryClient = useQueryClient();
  const query = useQuery(currentBillingQueryOptions());
  const [error, setError] = useState<string>();

  const billing = query.data?.ok === true ? query.data.value : null;
  const readFailure = query.data?.ok === false ? query.data.code : undefined;
  const sessionExpired = readFailure === "unauthorized";

  function fail(code: BillingFailureCode): void {
    setError(billingErrorMessage(code));
    void query.refetch();
  }

  return {
    billing,
    subscription: billing?.subscription ?? null,
    loading: query.isPending || query.isFetching,
    sessionExpired,
    error:
      error ??
      (readFailure !== undefined && !sessionExpired
        ? billingErrorMessage(readFailure)
        : undefined),
    setError,
    applySubscription: (value) => {
      queryClient.setQueryData<typeof query.data>(
        currentBillingQueryKey,
        (current) =>
          current?.ok === true
            ? { ok: true, value: { ...current.value, subscription: value } }
            : current,
      );
    },
    fail,
    refresh: () => {
      setError(undefined);
      void query.refetch();
    },
    settle: (result, onSuccess, onFailure) => {
      if (!result.ok) {
        onFailure?.(result.code);
        fail(result.code);
        return;
      }
      setError(undefined);
      onSuccess(result.value);
    },
  };
}

/**
 * Завершённая сессия объясняется один раз на раздел, поэтому соседняя панель спрашивает только
 * этот факт, а не всё состояние кабинета.
 */
export function useBillingSessionExpired(): boolean {
  const query = useQuery(currentBillingQueryOptions());
  return query.data?.ok === false && query.data.code === "unauthorized";
}
