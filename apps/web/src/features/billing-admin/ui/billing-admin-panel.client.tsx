"use client";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  billingErrorMessage,
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
  const operations = useRef(new Map<string, { key: string; id: string }>());

  function operationId(slot: string, payload: unknown): string {
    const key = JSON.stringify(payload);
    const current = operations.current.get(slot);
    if (current !== undefined && current.key === key) return current.id;
    const next = { key, id: crypto.randomUUID() };
    operations.current.set(slot, next);
    return next.id;
  }

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

  function dispatch<Input extends { readonly operationId: string }, Value>(
    slot: string,
    payload: Omit<Input, "operationId">,
    call: (input: Input) => Promise<BillingCommandResult<Value>>,
    apply: (value: Value) => void,
    notice: string,
  ): void {
    const input = {
      ...payload,
      operationId: operationId(slot, payload),
    } as Input;
    setError(undefined);
    setNotice(undefined);
    command.mutate({
      notice,
      run: async (): Promise<TaskOutcome> => {
        const result = await call(input);
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
          "grants.applyBatch",
          input,
          applyAccessGrantBatch,
          (value) => {
            setBatch(value.result);
            setPreview(null);
          },
          "Партия применена.",
        );
      }}
      onArchiveOffer={(input) => {
        dispatch(
          "offers.archive",
          input,
          archiveBillingOffer,
          () => undefined,
          "Предложение архивировано.",
        );
      }}
      onArchivePaymentOption={(input) => {
        dispatch(
          "paymentOptions.archive",
          input,
          archiveBillingPaymentOption,
          () => undefined,
          "Вариант оплаты архивирован.",
        );
      }}
      onArchivePromotion={(input) => {
        dispatch(
          "promotions.archive",
          input,
          archiveBillingPromotion,
          () => undefined,
          "Скидка архивирована.",
        );
      }}
      onCancelSubscription={(input) => {
        dispatch(
          "subscriptions.cancel",
          input,
          cancelOwnerSubscription,
          () => undefined,
          "Продление отменено; оплаченный срок сохранён.",
        );
      }}
      onDecideRefund={(input) => {
        dispatch(
          "refunds.decide",
          input,
          decideBillingRefund,
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
          "refunds.execute",
          input,
          executeBillingRefund,
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
          "grants.extend",
          input,
          extendAccessGrant,
          () => undefined,
          "Основание продлено.",
        );
      }}
      onListPayments={(input) => {
        dispatch(
          "payments.list",
          input,
          listBillingPayments,
          (value) => {
            setPayments(value.result.items);
            setPaymentsCursor(value.result.nextCursor);
          },
          "Список платежей обновлён.",
        );
      }}
      onPreviewBatch={(input) => {
        dispatch(
          "grants.previewBatch",
          input,
          previewAccessGrantBatch,
          (value) => {
            setPreview(value.result);
            setBatch(null);
          },
          "Предпросмотр собран; права ещё не выданы.",
        );
      }}
      onReadGrants={(input) => {
        dispatch(
          "grants.read",
          input,
          readAccessGrants,
          (value) => {
            setGrants(value.result.value);
          },
          "Права прочитаны.",
        );
      }}
      onReadPayment={(input) => {
        dispatch(
          "payments.read",
          input,
          readBillingPayment,
          (value) => {
            setPayment(value.result);
          },
          "Платёж прочитан.",
        );
      }}
      onReadRefunds={(input) => {
        dispatch(
          "refunds.read",
          input,
          readBillingRefunds,
          (value) => {
            setRefunds(value.result);
          },
          "Возвраты прочитаны.",
        );
      }}
      onReconcilePayment={(input) => {
        dispatch(
          "payments.reconcile",
          input,
          reconcileBillingPayment,
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
          "grants.revoke",
          input,
          revokeAccessGrant,
          () => undefined,
          "Основание отозвано.",
        );
      }}
      onSaveOffer={(input) => {
        dispatch(
          "offers.save",
          input,
          saveBillingOffer,
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
          "paymentOptions.save",
          input,
          saveBillingPaymentOption,
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
          "promotions.save",
          input,
          saveBillingPromotion,
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
