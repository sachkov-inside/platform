"use client";
import type { ReactNode } from "react";

import {
  billingActionClass,
  formatBillingDateTime,
  formatKopecks,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type {
  CancelSubscriptionInput,
  DecideRefundInput,
  ExecuteRefundInput,
  ListPaymentsInput,
  PaymentOutcome,
  PaymentView,
  PurchaseCommandInput,
  RefundsOutcome,
} from "../model/admin-operations";
import type { AdminCommand } from "./admin-command";
import {
  AdminField,
  AdminSection,
  AdminSelect,
  AdminTextArea,
  formText,
  onAdminSubmit,
  optionalFormText,
  reasonMaxLength,
} from "./admin-form.client";

export interface PaymentsSectionProps {
  readonly payments: readonly PaymentView[];
  readonly paymentsCursor: string | null;
  readonly payment: PaymentOutcome["result"] | null;
  readonly refunds: RefundsOutcome["result"] | null;
  readonly pending: boolean;
  readonly onListPayments: (input: AdminCommand<ListPaymentsInput>) => void;
  readonly onReadPayment: (input: AdminCommand<PurchaseCommandInput>) => void;
  readonly onReconcilePayment: (
    input: AdminCommand<PurchaseCommandInput>,
  ) => void;
  readonly onReadRefunds: (input: AdminCommand<PurchaseCommandInput>) => void;
  readonly onDecideRefund: (input: AdminCommand<DecideRefundInput>) => void;
  readonly onExecuteRefund: (input: AdminCommand<ExecuteRefundInput>) => void;
  readonly onCancelSubscription: (
    input: AdminCommand<CancelSubscriptionInput>,
  ) => void;
}

export function PaymentsSection({
  payments,
  paymentsCursor,
  payment,
  refunds,
  pending,
  onListPayments,
  onReadPayment,
  onReconcilePayment,
  onReadRefunds,
  onDecideRefund,
  onExecuteRefund,
  onCancelSubscription,
}: PaymentsSectionProps) {
  return (
    <>
      <AdminSection
        description="Банковское состояние попытки отделено от готовности доступа и от чека."
        title="Платежи"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            const accountId = optionalFormText(form.get("paymentsAccount"));
            const state = optionalFormText(form.get("paymentsState"));
            const kind = optionalFormText(form.get("paymentsKind"));
            onListPayments({
              limit: Number(formText(form.get("paymentsLimit")) || "50"),
              ...(accountId === undefined ? {} : { accountId }),
              ...(state === undefined || state === "any"
                ? {}
                : { state: state as ListPaymentsInput["state"] }),
              ...(kind === undefined || kind === "any"
                ? {}
                : { kind: kind as ListPaymentsInput["kind"] }),
            });
          })}
        >
          <AdminField
            hint="Пусто — все Account."
            label="Account"
            name="paymentsAccount"
          />
          <AdminSelect
            label="Состояние"
            name="paymentsState"
            options={[
              { value: "any", label: "Любое" },
              { value: "prepared", label: "prepared" },
              { value: "sent", label: "sent" },
              { value: "unknown", label: "unknown" },
              { value: "pending", label: "pending" },
              { value: "authorized", label: "authorized" },
              { value: "confirmed", label: "confirmed" },
              { value: "failed", label: "failed" },
            ]}
          />
          <AdminSelect
            label="Вид"
            name="paymentsKind"
            options={[
              { value: "any", label: "Любой" },
              { value: "initial", label: "initial" },
              { value: "renewal", label: "renewal" },
              { value: "upgrade", label: "upgrade" },
            ]}
          />
          <AdminField
            defaultValue="50"
            inputMode="numeric"
            label="Сколько показать"
            name="paymentsLimit"
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Показать платежи
            </Button>
          </p>
        </form>

        {payments.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Платежи</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-semibold">Платёж</th>
                  <th className="py-2 pr-3 font-semibold">Вид</th>
                  <th className="py-2 pr-3 font-semibold">Состояние</th>
                  <th className="py-2 pr-3 font-semibold">Сумма</th>
                  <th className="py-2 font-semibold">Доступ</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((row) => (
                  <tr className="border-b border-border" key={row.purchaseRef}>
                    <td className="py-2 pr-3 font-mono text-xs [overflow-wrap:anywhere]">
                      {row.purchaseRef}
                    </td>
                    <td className="py-2 pr-3">{row.kind}</td>
                    <td className="py-2 pr-3">{row.state}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">
                      {formatKopecks(row.amountKopecks)}
                    </td>
                    <td className="py-2">{row.access}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paymentsCursor === null ? null : (
              <p className="mt-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                Следующая страница: {paymentsCursor}
              </p>
            )}
          </div>
        )}

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={onAdminSubmit((form) => {
            onReadPayment({ purchaseRef: formText(form.get("paymentRef")) });
          })}
        >
          <AdminField label="Открыть платёж" name="paymentRef" required />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Прочитать
            </Button>
          </p>
        </form>

        {payment === null ? null : (
          <div className="grid gap-4 border-t border-border pt-5 text-sm">
            <dl className="grid gap-2">
              <AdminRow label="Платёж">{payment.value.purchaseRef}</AdminRow>
              <AdminRow label="Account">{payment.value.accountId}</AdminRow>
              <AdminRow label="Состояние">{payment.value.state}</AdminRow>
              <AdminRow label="Сумма">
                {formatKopecks(payment.value.amountKopecks)}
              </AdminRow>
              <AdminRow label="Возвращено">
                {formatKopecks(payment.value.refundedKopecks)}
              </AdminRow>
              <AdminRow label="Доступно к возврату">
                {formatKopecks(payment.value.refundableKopecks)}
              </AdminRow>
              <AdminRow label="Чек">{payment.value.fiscalization}</AdminRow>
              <AdminRow label="Терминал">
                {payment.value.environment} · {payment.value.terminalRef}
              </AdminRow>
            </dl>
            {payment.events.length === 0 ? null : (
              <div>
                <h3 className="font-semibold">События</h3>
                <ul className="mt-2 grid gap-1 font-mono text-xs">
                  {payment.events.map((entry) => (
                    <li key={`${entry.kind}:${entry.occurredAt}`}>
                      {formatBillingDateTime(entry.occurredAt)} · {entry.kind}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {payment.audit.length === 0 ? null : (
              <div>
                <h3 className="font-semibold">Журнал операций</h3>
                <ul className="mt-2 grid gap-1 text-xs">
                  {payment.audit.map((entry) => (
                    <li key={entry.operationId}>
                      <span className="font-mono">
                        {formatBillingDateTime(entry.createdAt)}
                      </span>{" "}
                      · {entry.operation} · {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="flex flex-wrap gap-2">
              <Button
                className={billingActionClass}
                disabled={pending}
                onClick={() => {
                  onReconcilePayment({
                    purchaseRef: payment.value.purchaseRef,
                  });
                }}
                type="button"
                variant="outline"
              >
                Сверить с банком
              </Button>
              <Button
                className={billingActionClass}
                disabled={pending}
                onClick={() => {
                  onReadRefunds({ purchaseRef: payment.value.purchaseRef });
                }}
                type="button"
                variant="ghost"
              >
                Показать возвраты
              </Button>
            </p>
          </div>
        )}
      </AdminSection>

      <AdminSection
        description="Решение фиксирует сумму, судьбу доступа и автопродления. Исполнение наследует основание своего решения и не принимает новую сумму."
        title="Возвраты"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            onDecideRefund({
              purchaseRef: formText(form.get("refundPurchase")),
              amountKopecks: Number(formText(form.get("refundAmount"))),
              access: formText(form.get("refundAccess")) as "keep" | "revoke",
              recurring: formText(form.get("refundRecurring")) as
                | "keep"
                | "cancel",
              reason: formText(form.get("refundReason")),
            });
          })}
        >
          <AdminField label="Платёж" name="refundPurchase" required />
          <AdminField
            hint="В копейках, не больше остатка."
            inputMode="numeric"
            label="Сумма"
            name="refundAmount"
            required
          />
          <AdminSelect
            label="Доступ"
            name="refundAccess"
            options={[
              { value: "keep", label: "Сохранить" },
              { value: "revoke", label: "Отозвать" },
            ]}
          />
          <AdminSelect
            label="Автопродление"
            name="refundRecurring"
            options={[
              { value: "keep", label: "Сохранить" },
              { value: "cancel", label: "Отменить" },
            ]}
          />
          <AdminTextArea
            label="Основание"
            maxLength={reasonMaxLength}
            name="refundReason"
            required
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Принять решение
            </Button>
          </p>
        </form>

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={onAdminSubmit((form) => {
            onExecuteRefund({
              decisionRef: formText(form.get("executeDecision")),
              expectedRevision: Number(formText(form.get("executeRevision"))),
            });
          })}
        >
          <AdminField label="Решение" name="executeDecision" required />
          <AdminField
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="executeRevision"
            required
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
            >
              Исполнить возврат
            </Button>
          </p>
        </form>

        {refunds === null ? null : (
          <div className="border-t border-border pt-5 text-sm">
            <p>
              По платежу{" "}
              <span className="font-mono text-xs">{refunds.purchaseRef}</span>{" "}
              возвращено {formatKopecks(refunds.refundedKopecks)} из доступных{" "}
              {formatKopecks(refunds.refundableKopecks)}.
            </p>
            <ul className="mt-3 grid gap-2">
              {refunds.decisions.map((decision) => (
                <li className="grid gap-1" key={decision.decisionRef}>
                  <span className="font-mono text-xs [overflow-wrap:anywhere]">
                    {decision.decisionRef} · r{decision.revision} ·{" "}
                    {decision.state}
                  </span>
                  <span>
                    {formatKopecks(decision.amountKopecks)} · доступ{" "}
                    {decision.access} · продление {decision.recurring}
                  </span>
                  {decision.attempt === null ? null : (
                    <span className="text-xs text-muted-foreground">
                      Попытка {decision.attempt.state}
                      {decision.attempt.observedStatus === null
                        ? ""
                        : ` · ${decision.attempt.observedStatus}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminSection>

      <AdminSection
        description="Отмена продления владельцем выполняет тот же use case, что и команда покупателя: оплаченный срок сохраняется."
        title="Подписка участника"
      >
        <form
          className="grid gap-4"
          onSubmit={onAdminSubmit((form) => {
            onCancelSubscription({
              accountId: formText(form.get("cancelAccount")),
              expectedRevision: Number(formText(form.get("cancelRevision"))),
              reason: formText(form.get("cancelReason")),
            });
          })}
        >
          <AdminField label="Account" name="cancelAccount" required />
          <AdminField
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="cancelRevision"
            required
          />
          <AdminTextArea
            label="Основание"
            maxLength={reasonMaxLength}
            name="cancelReason"
            required
          />
          <p>
            <Button
              className={billingActionClass}
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Отменить продление
            </Button>
          </p>
        </form>
      </AdminSection>
    </>
  );
}

function AdminRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}
