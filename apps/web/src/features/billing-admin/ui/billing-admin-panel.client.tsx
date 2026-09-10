"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  billingErrorMessage,
  useBillingOperations,
  type BillingCommandResult,
  type BillingFailureCode,
  type PriceSnapshot,
} from "@/entities/subscription";

import {
  applyAccessGrantBatch,
  archiveBillingOffer,
  archiveBillingPaymentOption,
  archiveBillingPromotion,
  cancelOwnerSubscription,
  decideBillingRefund,
  executeBillingRefund,
  extendAccessGrant,
  listBillingPayments,
  previewAccessGrantBatch,
  readAccessGrants,
  readBillingPayment,
  readBillingRefunds,
  reconcileBillingPayment,
  revokeAccessGrant,
  saveBillingOffer,
  saveBillingPaymentOption,
  saveBillingPromotion,
} from "../api/billing-admin.browser";
import type {
  GrantBatchOutcome,
  GrantPreviewOutcome,
  GrantsOutcome,
  PaymentOutcome,
  PaymentView,
  RefundsOutcome,
} from "../model/admin-operations";
import { BillingAdminView } from "./billing-admin-view.client";

type TaskOutcome =
  | { readonly ok: true; readonly apply: () => void }
  | { readonly ok: false; readonly code: BillingFailureCode };

interface Task {
  readonly run: () => Promise<TaskOutcome>;
  readonly notice: string;
}

export interface BillingAdminPanelProps {
  readonly offers: readonly PriceSnapshot[];
}

/**
 * Владельческие команды повторяются безопасно: тот же `operationId` сохраняется, пока не
 * изменилась нагрузка, поэтому повтор читает исходный результат, а не создаёт второй.
 */
export function BillingAdminPanel({ offers }: BillingAdminPanelProps) {
  const [payments, setPayments] = useState<readonly PaymentView[]>([]);
  const [paymentsCursor, setPaymentsCursor] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentOutcome["result"] | null>(null);
  const [refunds, setRefunds] = useState<RefundsOutcome["result"] | null>(null);
  const [grants, setGrants] = useState<
    GrantsOutcome["result"]["value"] | null
  >(null);
  const [preview, setPreview] = useState<
    GrantPreviewOutcome["result"] | null
  >(null);
  const [batch, setBatch] = useState<GrantBatchOutcome["result"] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const operationId = useBillingOperations();

  const command = useMutation({
    retry: false,
    mutationFn: async (task: Task) => ({ task, result: await task.run() }),
    onSuccess: ({ task, result }) => {
      if (!result.ok) {
        setNotice(undefined);
        setError(billingErrorMessage(result.code));
        return;
      }
      setError(undefined);
      setNotice(task.notice);
      result.apply();
    },
  });

  /**
   * Каждая операция вызывает собственный адаптер со своим точным типом; сюда попадает уже
   * готовый вызов, поэтому общий исход не размывает контракт отдельной команды.
   */
  function dispatch<Value>(
    call: () => Promise<BillingCommandResult<Value>>,
    apply: (value: Value) => void,
    notice: string,
  ): void {
    setError(undefined);
    setNotice(undefined);
    command.mutate({
      notice,
      run: async (): Promise<TaskOutcome> => {
        const result = await call();
        return result.ok
          ? {
              ok: true,
              apply: () => {
                apply(result.value);
              },
            }
          : { ok: false, code: result.code };
      },
    });
  }

  return (
    <BillingAdminView
      batch={batch}
      error={error}
      grants={grants}
      notice={notice}
      offers={offers}
      onApplyBatch={(input) => {
        dispatch(
          () =>
            applyAccessGrantBatch({
              ...input,
              operationId: operationId("grants.applyBatch", input),
            }),
          (value) => {
            setBatch(value.result);
            setPreview(null);
          },
          "Партия применена.",
        );
      }}
      onArchiveOffer={(input) => {
        dispatch(
          () =>
            archiveBillingOffer({
              ...input,
              operationId: operationId("offers.archive", input),
            }),
          () => undefined,
          "Предложение архивировано.",
        );
      }}
      onArchivePaymentOption={(input) => {
        dispatch(
          () =>
            archiveBillingPaymentOption({
              ...input,
              operationId: operationId("paymentOptions.archive", input),
            }),
          () => undefined,
          "Вариант оплаты архивирован.",
        );
      }}
      onArchivePromotion={(input) => {
        dispatch(
          () =>
            archiveBillingPromotion({
              ...input,
              operationId: operationId("promotions.archive", input),
            }),
          () => undefined,
          "Скидка архивирована.",
        );
      }}
      onCancelSubscription={(input) => {
        dispatch(
          () =>
            cancelOwnerSubscription({
              ...input,
              operationId: operationId("subscriptions.cancel", input),
            }),
          () => undefined,
          "Продление отменено; оплаченный срок сохранён.",
        );
      }}
      onDecideRefund={(input) => {
        dispatch(
          () =>
            decideBillingRefund({
              ...input,
              operationId: operationId("refunds.decide", input),
            }),
          (value) => {
            setNotice(
              `Решение ${value.result.value.decisionRef}, редакция ${String(value.result.value.revision)}.`,
            );
          },
          "Решение о возврате записано.",
        );
      }}
      onExecuteRefund={(input) => {
        dispatch(
          () =>
            executeBillingRefund({
              ...input,
              operationId: operationId("refunds.execute", input),
            }),
          (value) => {
            setNotice(
              `Состояние решения: ${value.result.value.state}. Банк отвечает своим исходом.`,
            );
          },
          "Возврат отправлен.",
        );
      }}
      onExtendGrant={(input) => {
        dispatch(
          () =>
            extendAccessGrant({
              ...input,
              operationId: operationId("grants.extend", input),
            }),
          () => undefined,
          "Основание продлено.",
        );
      }}
      onListPayments={(input) => {
        dispatch(
          () =>
            listBillingPayments({
              ...input,
              operationId: operationId("payments.list", input),
            }),
          (value) => {
            setPayments(value.result.items);
            setPaymentsCursor(value.result.nextCursor);
          },
          "Список платежей обновлён.",
        );
      }}
      onPreviewBatch={(input) => {
        dispatch(
          () =>
            previewAccessGrantBatch({
              ...input,
              operationId: operationId("grants.previewBatch", input),
            }),
          (value) => {
            setPreview(value.result);
            setBatch(null);
          },
          "Предпросмотр собран; права ещё не выданы.",
        );
      }}
      onReadGrants={(input) => {
        dispatch(
          () =>
            readAccessGrants({
              ...input,
              operationId: operationId("grants.read", input),
            }),
          (value) => {
            setGrants(value.result.value);
          },
          "Права прочитаны.",
        );
      }}
      onReadPayment={(input) => {
        dispatch(
          () =>
            readBillingPayment({
              ...input,
              operationId: operationId("payments.read", input),
            }),
          (value) => {
            setPayment(value.result);
          },
          "Платёж прочитан.",
        );
      }}
      onReadRefunds={(input) => {
        dispatch(
          () =>
            readBillingRefunds({
              ...input,
              operationId: operationId("refunds.read", input),
            }),
          (value) => {
            setRefunds(value.result);
          },
          "Возвраты прочитаны.",
        );
      }}
      onReconcilePayment={(input) => {
        dispatch(
          () =>
            reconcileBillingPayment({
              ...input,
              operationId: operationId("payments.reconcile", input),
            }),
          (value) => {
            setPayment((current) =>
              current === null
                ? current
                : { ...current, value: value.result.value },
            );
          },
          "Платёж сверен с банком.",
        );
      }}
      onRevokeGrant={(input) => {
        dispatch(
          () =>
            revokeAccessGrant({
              ...input,
              operationId: operationId("grants.revoke", input),
            }),
          () => undefined,
          "Основание отозвано.",
        );
      }}
      onSaveOffer={(input) => {
        dispatch(
          () =>
            saveBillingOffer({
              ...input,
              operationId: operationId("offers.save", input),
            }),
          (value) => {
            setNotice(
              `Предложение сохранено, редакция ${String(value.result.value.revision)}.`,
            );
          },
          "Предложение сохранено.",
        );
      }}
      onSavePaymentOption={(input) => {
        dispatch(
          () =>
            saveBillingPaymentOption({
              ...input,
              operationId: operationId("paymentOptions.save", input),
            }),
          (value) => {
            setNotice(
              `Вариант сохранён, редакция ${String(value.result.value.revision)}.`,
            );
          },
          "Вариант оплаты сохранён.",
        );
      }}
      onSavePromotion={(input) => {
        dispatch(
          () =>
            saveBillingPromotion({
              ...input,
              operationId: operationId("promotions.save", input),
            }),
          (value) => {
            setNotice(
              `Скидка сохранена, редакция ${String(value.result.value.revision)}.`,
            );
          },
          "Скидка сохранена.",
        );
      }}
      payment={payment}
      payments={payments}
      paymentsCursor={paymentsCursor}
      pending={command.isPending}
      preview={preview}
      refunds={refunds}
    />
  );
}
