"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  billingErrorMessage,
  type BillingCommandResult,
  type BillingFailureCode,
  type CurrentBilling,
  type SubscriptionView,
} from "@/entities/subscription";

import {
  currentBillingChanged,
  currentBillingQueryKey,
  resetCurrentBilling,
} from "./current-billing";
import { useCurrentBilling } from "./use-current-billing.client";

export interface BillingCabinet {
  readonly billing: CurrentBilling | null;
  readonly subscription: SubscriptionView | null;
  readonly loading: boolean;
  readonly sessionExpired: boolean;
  readonly error: string | undefined;
  readonly setError: (message: string | undefined) => void;
  /**
   * Команда вернула новый вид подписки. Его revision становится ожидаемой для следующей команды
   * здесь, а остальные открытые поверхности узнают о записи из объявления.
   */
  readonly applySubscription: (value: SubscriptionView) => void;
  readonly fail: (code: BillingFailureCode) => void;
  /** Команда изменила состояние, но нового вида не вернула: объявить запись и перечитать. */
  readonly rereadAfterCommand: () => void;
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
  const query = useCurrentBilling();
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
      currentBillingChanged.announce();
    },
    fail,
    rereadAfterCommand: () => {
      setError(undefined);
      // Объявление уходит раньше перечитывания: команда смены способа оплаты сразу уводит
      // покупателя в банк, и соседние поверхности не должны зависеть от этой страницы.
      currentBillingChanged.announce();
      void resetCurrentBilling(queryClient);
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
  const query = useCurrentBilling();
  return query.data?.ok === false && query.data.code === "unauthorized";
}
