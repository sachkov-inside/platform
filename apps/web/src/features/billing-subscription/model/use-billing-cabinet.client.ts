"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  billingErrorMessage,
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
    fail: (code) => {
      setError(billingErrorMessage(code));
      void query.refetch();
    },
    refresh: () => {
      setError(undefined);
      void query.refetch();
    },
  };
}
