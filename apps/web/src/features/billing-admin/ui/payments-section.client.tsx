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
  ListPaymentsInput,
  PaymentOutcome,
  PaymentView,
  PurchaseCommandInput,
  RefundsOutcome,
} from "../model/admin-operations";
import { listPaymentsInputSchema } from "../model/admin-operations";
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
import { presentText } from "@/shared/lib/text";

/** Основание возврата словами владельца и его последствие: одна карта для выбора и для истории решений. */
const refundBases = {
  withdrawal: { label: "отказ от договора", consequence: "права прекращаются" },
  compensation: {
    label: "компенсация без отказа",
    consequence: "доступ сохраняется",
  },
} as const;
export interface PaymentsSectionProps {
  readonly payments: readonly PaymentView[];
  readonly paymentsCursor: string | null;
  readonly paymentsFilters: AdminCommand<ListPaymentsInput> | null;
  readonly payment: PaymentOutcome["result"] | null;
  readonly refunds: RefundsOutcome["result"] | null;
  readonly pending: boolean;
  readonly onListPayments: (input: AdminCommand<ListPaymentsInput>) => void;
  readonly onReadPayment: (input: AdminCommand<PurchaseCommandInput>) => void;
  readonly onReconcilePayment: (
    input: AdminCommand<PurchaseCommandInput>,
  ) => void;
  readonly onReadRefunds: (input: AdminCommand<PurchaseCommandInput>) => void;
  readonly onCancelSubscription: (
    input: AdminCommand<CancelSubscriptionInput>,
  ) => void;
}

export function PaymentsSection({
  payments,
  paymentsCursor,
  paymentsFilters,
  payment,
  refunds,
  pending,
  onListPayments,
  onReadPayment,
  onReconcilePayment,
  onReadRefunds,
  onCancelSubscription,
}: PaymentsSectionProps) {
  return (
    <>
      <AdminSection
        description="Банковское состояние попытки отделено от готовности доступа и от чека."
        title="Платежи"
      >
        <form
          className="payment-filters"
          onSubmit={onAdminSubmit((form) => {
            const accountId = optionalFormText(form.get("paymentsAccount"));
            // «any» и пустое поле не проходят схему фильтра и означают «без фильтра».
            const state = listPaymentsInputSchema.shape.state.safeParse(
              optionalFormText(form.get("paymentsState")),
            ).data;
            const kind = listPaymentsInputSchema.shape.kind.safeParse(
              optionalFormText(form.get("paymentsKind")),
            ).data;
            const input: AdminCommand<ListPaymentsInput> = {
              limit: Number(
                presentText(formText(form.get("paymentsLimit"))) ?? "50",
              ),
              ...(accountId === undefined ? {} : { accountId }),
              ...(state === undefined ? {} : { state }),
              ...(kind === undefined ? {} : { kind }),
            };
            onListPayments(input);
          })}
        >
          <AdminSelect
            label="Состояние"
            name="paymentsState"
            options={[
              { value: "any", label: "Любое" },
              { value: "prepared", label: "Подготовлен" },
              { value: "sent", label: "Отправлен в банк" },
              { value: "unknown", label: "Требует сверки" },
              { value: "pending", label: "Ожидает оплаты" },
              { value: "authorized", label: "Авторизован" },
              { value: "confirmed", label: "Оплачен" },
              { value: "failed", label: "Ошибка" },
            ]}
          />
          <details className="payment-extra-filters">
            <summary>Дополнительные фильтры</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <AdminField
                hint="Пусто — все Account."
                label="Account"
                name="paymentsAccount"
              />
              <AdminSelect
                label="Вид"
                name="paymentsKind"
                options={[
                  { value: "any", label: "Любой" },
                  { value: "initial", label: "Первая покупка" },
                  { value: "one_time", label: "Разовая покупка" },
                  { value: "renewal", label: "Продление" },
                  { value: "upgrade", label: "Смена тарифа" },
                ]}
              />
              <AdminField
                defaultValue="50"
                inputMode="numeric"
                label="Сколько показать"
                name="paymentsLimit"
              />
            </div>
          </details>
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
          <div className="grid gap-4">
            <ul
              className="grid divide-y divide-border sm:hidden"
              aria-label="Платежи"
            >
              {payments.map((row) => (
                <li
                  className="grid gap-3 py-4 first:pt-0"
                  key={row.purchaseRef}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {paymentStateLabel(row.state)}
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {formatKopecks(row.amountKopecks)}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Вид</dt>
                      <dd>{paymentKindLabel(row.kind)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Доступ</dt>
                      <dd>{paymentAccessLabel(row.access)}</dd>
                    </div>
                  </dl>
                  <button
                    className="min-h-11 break-all text-left text-xs underline underline-offset-4"
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onReadPayment({ purchaseRef: row.purchaseRef });
                    }}
                  >
                    Открыть платёж {row.purchaseRef}
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
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
                    <tr
                      className="border-b border-border"
                      key={row.purchaseRef}
                    >
                      <td className="py-2 pr-3 font-mono text-xs [overflow-wrap:anywhere]">
                        <button
                          className="min-h-11 text-left underline underline-offset-4 hover:text-accent-hover"
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            onReadPayment({ purchaseRef: row.purchaseRef });
                          }}
                        >
                          {row.purchaseRef}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        {paymentKindLabel(row.kind)}
                      </td>
                      <td className="py-2 pr-3">
                        {paymentStateLabel(row.state)}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums">
                        {formatKopecks(row.amountKopecks)}
                      </td>
                      <td className="py-2">{paymentAccessLabel(row.access)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {paymentsCursor === null || paymentsFilters === null ? null : (
              <Button
                className="mt-4"
                variant="outline"
                type="button"
                disabled={pending}
                onClick={() => {
                  onListPayments({
                    ...paymentsFilters,
                    cursor: paymentsCursor,
                  });
                }}
              >
                Следующая страница
              </Button>
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
              <AdminRow label="Состояние">
                {paymentStateLabel(payment.value.state)}
              </AdminRow>
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

      <details className="authoring-disclosure">
        <summary>История возвратов</summary>
        <AdminSection
          description="Покупатель обращается к продавцу. Продавец выполняет возврат только в кабинете Т-Банка. Здесь доступна история подтверждённых возвратов."
          title="Возвраты"
        >
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
                      {formatKopecks(decision.amountKopecks)} · основание{" "}
                      {decision.basis === null
                        ? "не указано"
                        : refundBases[decision.basis].label}{" "}
                      · доступ {decision.access} · продление{" "}
                      {decision.recurring}
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
      </details>
      <details className="authoring-disclosure">
        <summary>Отменить продление подписки участника</summary>
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
      </details>
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

function paymentStateLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    prepared: "Подготовлен",
    sent: "Отправлен в банк",
    unknown: "Требует сверки",
    pending: "Ожидает оплаты",
    authorized: "Авторизован",
    confirmed: "Оплачен",
    failed: "Ошибка",
  };
  return labels[value] ?? value;
}
function paymentKindLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    initial: "Первая покупка",
    one_time: "Разовая покупка",
    renewal: "Продление",
    upgrade: "Смена тарифа",
  };
  return labels[value] ?? value;
}

function paymentAccessLabel(value: PaymentView["access"]): string {
  const labels = {
    awaiting_payment: "Ожидает оплаты",
    preparing: "Готовится",
    ready: "Готов",
  };
  return labels[value];
}
