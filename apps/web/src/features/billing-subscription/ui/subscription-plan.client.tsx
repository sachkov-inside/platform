"use client";
import type { ReactNode } from "react";

import {
  billingActionClass,
  attemptStateLabel,
  benefitLines,
  formatBillingDate,
  formatBillingDateTime,
  formatKopecks,
  subscriptionStateLabel,
  type SubscriptionView,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export interface SubscriptionPlanProps {
  readonly subscription: SubscriptionView;
  readonly pending: boolean;
  readonly onCancelPendingChange: () => void;
}

/**
 * Действующие условия подписки: состав, оплаченный срок и следующее списание. Способ оплаты
 * и история денег принадлежат разделу «Покупки»; банковское состояние попытки и готовность
 * доступа остаются разными фактами.
 */
export function SubscriptionPlan({
  subscription,
  pending,
  onCancelPendingChange,
}: SubscriptionPlanProps) {
  const renewal =
    subscription.pendingChange?.snapshot.renewalPriceKopecks ??
    subscription.snapshot.renewalPriceKopecks;
  return (
      <section
        aria-labelledby="billing-plan"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2
            className="min-w-0 text-2xl font-bold tracking-[-0.035em] [overflow-wrap:anywhere]"
            id="billing-plan"
          >
            {subscription.snapshot.offer.name}
          </h2>
          <p className="inline-flex min-h-7 items-center rounded-full bg-secondary px-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
            {subscriptionStateLabel(subscription.state)}
          </p>
        </div>

        <ul className="mt-4 grid gap-2 text-sm leading-6">
          {benefitLines(
            subscription.snapshot.offer,
            subscription.snapshot.paymentOption.months,
          ).map((line) => (
            <li className="flex flex-wrap gap-x-2" key={line.capability}>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {line.label}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {line.term}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 grid gap-3 border-t border-border pt-5 text-sm">
          <Row label="Оплачено до">
            <span className="font-mono tabular-nums">
              {formatBillingDate(subscription.paidUntil)}
            </span>
          </Row>
          <Row label="Текущий период">
            <span className="font-mono tabular-nums">
              {formatBillingDate(subscription.periodStartsAt)} —{" "}
              {formatBillingDate(subscription.paidUntil)}
            </span>
          </Row>
          <Row label="Сумма периода">
            <span className="font-mono tabular-nums">
              {formatKopecks(subscription.periodAmountKopecks)}
            </span>
          </Row>
          <Row label="Следующее списание">
            {subscription.state === "active" && renewal !== null ? (
              <span className="font-mono tabular-nums">
                {formatBillingDate(subscription.paidUntil)} ·{" "}
                {formatKopecks(renewal)}
              </span>
            ) : (
              <span>Списаний больше не будет</span>
            )}
          </Row>
          <Row label="Ссылка для поддержки">
            <span className="font-mono text-xs [overflow-wrap:anywhere]">
              {subscription.subscriptionRef}
              {subscription.inFlightPayment === null
                ? ""
                : ` · операция ${subscription.inFlightPayment.attemptRef}`}
            </span>
          </Row>
        </dl>

        {subscription.inFlightPayment === null ? null : (
          <p className="mt-4 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6" role="status">
            Незавершённая операция:{" "}
            {attemptStateLabel(subscription.inFlightPayment.state)}. Новую
            оплату начинать не нужно.
          </p>
        )}

        {subscription.pendingChange === null ? null : (
          <div className="mt-4 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
            <p className="font-semibold">
              Со следующего периода —{" "}
              {subscription.pendingChange.snapshot.offer.name}
            </p>
            <p className="mt-1 text-muted-foreground">
              Согласовано{" "}
              {formatBillingDateTime(subscription.pendingChange.acceptedAt)}.
              Цена следующего периода:{" "}
              {formatKopecks(
                subscription.pendingChange.snapshot.renewalPriceKopecks,
              )}
              .
            </p>
            <Button
              className={`mt-3 ${billingActionClass}`}
              disabled={pending}
              onClick={onCancelPendingChange}
              type="button"
              variant="outline"
            >
              Отменить изменение
            </Button>
          </div>
        )}
      </section>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
