"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  ownerPaymentQueryOptions,
  ownerPaymentsKey,
  paymentStateLabels,
  reconcilePaymentOperation,
} from "@/features/owner-payments";
import type { BillingFailureCode } from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import { OrderEmailPanel } from "./order-email.client";
import {
  SalesPaymentFailure,
  SalesPaymentLoading,
} from "./sales-payment-states";
import { SalesPaymentView } from "./sales-payment-view.client";

const reconcileSlot = "payments.reconcile";

/** Страница платежа: чтение платежа с журналом, сверка с банком и отдельный email заказа. */
export function SalesPaymentQuery({
  purchaseRef,
}: {
  readonly purchaseRef: string;
}) {
  const payment = useInfiniteQuery(ownerPaymentQueryOptions(purchaseRef));
  const queryClient = useQueryClient();
  const operations = useRepeatableOperations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reconcile = useMutation({
    mutationFn: reconcilePaymentOperation.send,
    onSuccess: (result) => {
      if (result.ok) {
        operations.completeOperation(reconcileSlot);
        setDialogOpen(false);
        setError(null);
        setNotice(
          `Сверка выполнена. Состояние оплаты: ${paymentStateLabels[result.value.result.value.state]}.`,
        );
        // Сверка меняет платёж, его события и журнал, а с ними и строку списка.
        void queryClient.invalidateQueries({ queryKey: ownerPaymentsKey });
        return;
      }
      // Без ответа сервера повтор присоединяется к той же операции; ответ с отказом её завершает.
      if (result.code !== "unavailable")
        operations.completeOperation(reconcileSlot);
      setError(reconcileErrorText(result.code));
    },
    onError: () => {
      setError(reconcileErrorText("unavailable"));
    },
  });

  if (payment.isPending) return <SalesPaymentLoading />;
  const pages = payment.data?.pages ?? [];
  const first = pages[0] ?? { kind: "unavailable" as const };
  if (first.kind !== "ready")
    return (
      <SalesPaymentFailure
        onRetry={() => {
          void payment.refetch();
        }}
        state={first}
      />
    );

  return (
    <SalesPaymentView
      audit={pages.flatMap((page) =>
        page.kind === "ready" ? page.value.audit : [],
      )}
      auditContinuation={{
        failed: payment.isFetchNextPageError,
        hasMore: payment.hasNextPage,
        loading: payment.isFetchingNextPage,
        onLoadMore: () => {
          void payment.fetchNextPage();
        },
      }}
      orderEmail={<OrderEmailPanel purchaseRef={purchaseRef} />}
      page={first.value}
      reconcile={{
        error,
        notice,
        onConfirm: () => {
          setError(null);
          setNotice(null);
          reconcile.mutate({
            operationId: operations.operationId(reconcileSlot, { purchaseRef }),
            purchaseRef,
          });
        },
        onOpenChange: (open) => {
          setDialogOpen(open);
          if (open) setError(null);
        },
        open: dialogOpen,
        pending: reconcile.isPending,
      }}
    />
  );
}

const reconcileErrors: Partial<Record<BillingFailureCode, string>> = {
  unauthorized: "Сессия закончилась. Войдите снова и повторите сверку.",
  forbidden: "У этого аккаунта нет права сверять платежи.",
  not_found: "Платёж не найден. Откройте его заново из списка.",
  provider_unavailable:
    "Банк сейчас не ответил. Платёж не изменился, повторите сверку позже.",
  dependency_unavailable:
    "Банк сейчас не ответил. Платёж не изменился, повторите сверку позже.",
  payment_in_progress:
    "Банк ещё обрабатывает оплату. Повторите сверку через несколько минут.",
};

/** Отказ сверки словами владельца: что случилось и что делать дальше. */
export function reconcileErrorText(code: BillingFailureCode): string {
  return (
    reconcileErrors[code] ??
    "Сверка не выполнена. Платёж не изменился, повторите позже."
  );
}
