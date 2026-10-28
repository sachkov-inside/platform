"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  PaymentBuyer,
  auditOperationLabel,
  environmentLabels,
  fiscalizationLabels,
  paymentAccessBadge,
  paymentEventLabel,
  paymentKindLabels,
  paymentProductName,
  paymentStateBadge,
  refundAmountText,
  refundAttemptStateLabels,
  refundBasisLabels,
  refundConsequenceText,
  refundDecisionStateLabels,
  type PaymentAuditEntry,
  type PaymentPage,
} from "@/features/owner-payments";
import { formatMoscowDateTime, formatRubles } from "@/shared/lib/moscow-format";
import { authoringPaymentsHref } from "@/shared/routing/authoring";
import { StateBadge } from "@/shared/ui/admin";
import { Button } from "@/shared/ui/button";

import { CopyValue } from "./copy-value.client";
import { ReconcileDialog } from "./reconcile-dialog.client";

export const salesPaymentHeadingId = "sales-payment-heading";

/** Продолжение журнала операций: следующая страница читается по кнопке. */
export interface AuditContinuation {
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onLoadMore: () => void;
}

/** Сверка с банком: подтверждение, ход и итог последней попытки. */
export interface ReconcileControl {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  /** Итог удачной сверки, озвучивается на странице. */
  readonly notice: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}

/**
 * Страница платежа: банковское состояние и готовность доступа, суммы и возвраты, события банка,
 * журнал операций владельца и сверка с банком. Email заказа приходит отдельным блоком.
 */
export function SalesPaymentView({
  page,
  audit,
  auditContinuation,
  reconcile,
  orderEmail,
}: {
  readonly page: Omit<PaymentPage, "audit" | "nextAuditAfter">;
  readonly audit: readonly PaymentAuditEntry[];
  readonly auditContinuation: AuditContinuation;
  readonly reconcile: ReconcileControl;
  readonly orderEmail: ReactNode;
}) {
  const payment = page.value;
  const productName = paymentProductName(payment);
  return (
    <SalesPaymentFrame>
      <header className="grid gap-3">
        <h1
          className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"
          id={salesPaymentHeadingId}
        >
          {productName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Заказ от{" "}
          <time dateTime={payment.createdAt}>
            {formatMoscowDateTime(payment.createdAt)}
          </time>
          {" · "}
          {paymentKindLabels[payment.kind]}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-2xl font-semibold tabular-nums">
            {formatRubles(payment.amountKopecks)}
          </p>
          <span className="flex flex-wrap gap-1">
            <StateBadge state={paymentStateBadge(payment.state)} />
            {payment.state === "confirmed" ? (
              <StateBadge state={paymentAccessBadge(payment.access)} />
            ) : null}
          </span>
        </div>
      </header>

      {payment.state === "unknown" ? (
        <div
          className="flex gap-3 rounded-xl border border-border bg-muted p-4 text-sm"
          data-payment-unknown=""
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>
            Банк не сообщил итог этой оплаты. Сверьте платёж с банком, прежде
            чем отвечать покупателю: пока итога нет, нельзя считать, что оплата
            прошла или не прошла.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11 px-4"
          onClick={() => {
            reconcile.onOpenChange(true);
          }}
          type="button"
          variant="outline"
        >
          Сверить с банком
        </Button>
        <p aria-live="polite" className="text-sm" role="status">
          {reconcile.notice ?? ""}
        </p>
      </div>

      <section aria-labelledby="payment-summary-heading" className="grid gap-3">
        <h2 className="text-base font-semibold" id="payment-summary-heading">
          Сводка
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[13rem_minmax(0,1fr)]">
          <Fact label="Покупатель">
            <PaymentBuyer accountId={payment.accountId} />
          </Fact>
          <Fact label="Номер заказа">
            <CopyValue label="номер заказа" value={payment.purchaseRef} />
          </Fact>
          <Fact label="Номер платежа в банке">
            {payment.paymentId === null ? (
              "Банк ещё не присвоил"
            ) : (
              <CopyValue label="номер платежа" value={payment.paymentId} />
            )}
          </Fact>
          <Fact label="Сумма">
            <span className="tabular-nums">
              {formatRubles(payment.amountKopecks)}
            </span>
          </Fact>
          <Fact label="Возвращено">
            <span className="tabular-nums">
              {refundAmountText(payment.refundedKopecks)}
            </span>
          </Fact>
          <Fact label="Можно вернуть">
            <span className="tabular-nums">
              {refundAmountText(payment.refundableKopecks)}
            </span>
          </Fact>
          <Fact label="Оплачен">
            {payment.confirmedAt === null ? (
              "Оплата не подтверждена"
            ) : (
              <time dateTime={payment.confirmedAt}>
                {formatMoscowDateTime(payment.confirmedAt)}
              </time>
            )}
          </Fact>
          <Fact label="Чек">{fiscalizationLabels[payment.fiscalization]}</Fact>
          <Fact label="Терминал">
            {environmentLabels[payment.environment]}
            <span className="text-muted-foreground">
              {" · "}
              <span className="font-mono text-[13px]">
                {payment.terminalRef}
              </span>
            </span>
          </Fact>
        </dl>
      </section>

      {orderEmail}

      <section aria-labelledby="payment-refunds-heading" className="grid gap-3">
        <h2 className="text-base font-semibold" id="payment-refunds-heading">
          Возвраты
        </h2>
        <p className="text-sm text-muted-foreground">
          Возврат делается в кабинете банка, здесь видна его история.
        </p>
        {page.decisions.length === 0 ? (
          <p className="text-sm">Возвратов по этому платежу не было.</p>
        ) : (
          <ul className="grid gap-3">
            {page.decisions.map((decision) => (
              <li
                className="grid gap-1 rounded-xl border border-border p-4 text-sm"
                key={decision.decisionRef}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold tabular-nums">
                    {formatRubles(decision.amountKopecks)}
                  </span>
                  <span>{refundDecisionStateLabels[decision.state]}</span>
                </span>
                <span>
                  {decision.basis === null
                    ? "Основание не указано"
                    : refundBasisLabels[decision.basis]}
                  {": "}
                  {refundConsequenceText(decision)}
                </span>
                {decision.attempt === null ? null : (
                  <span className="text-muted-foreground">
                    Банк: {refundAttemptStateLabels[decision.attempt.state]}
                  </span>
                )}
                {decision.reason.trim() === "" ? null : (
                  <span className="text-muted-foreground [overflow-wrap:anywhere]">
                    {decision.reason}
                  </span>
                )}
                <time
                  className="text-muted-foreground"
                  dateTime={decision.createdAt}
                >
                  {formatMoscowDateTime(decision.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="payment-events-heading" className="grid gap-3">
        <h2 className="text-base font-semibold" id="payment-events-heading">
          События банка
        </h2>
        {page.events.length === 0 ? (
          <p className="text-sm">Банк пока не присылал событий.</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {page.events.map((event) => (
              <li
                className="grid gap-x-4 sm:grid-cols-[11rem_minmax(0,1fr)]"
                key={`${event.kind}:${event.occurredAt}`}
              >
                <time
                  className="text-muted-foreground tabular-nums"
                  dateTime={event.occurredAt}
                >
                  {formatMoscowDateTime(event.occurredAt)}
                </time>
                <span className="[overflow-wrap:anywhere]">
                  {paymentEventLabel(event.kind)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="payment-audit-heading" className="grid gap-3">
        <h2 className="text-base font-semibold" id="payment-audit-heading">
          Журнал операций
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm">
            Владелец ещё не выполнял операций с платежом.
          </p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {audit.map((entry) => (
              <li
                className="grid gap-x-4 sm:grid-cols-[11rem_minmax(0,1fr)]"
                key={entry.operationId}
              >
                <time
                  className="text-muted-foreground tabular-nums"
                  dateTime={entry.createdAt}
                >
                  {formatMoscowDateTime(entry.createdAt)}
                </time>
                <span className="[overflow-wrap:anywhere]">
                  {auditOperationLabel(entry.operation)}
                  {entry.reason.trim() === "" ? null : (
                    <span className="text-muted-foreground">
                      {". "}
                      {entry.reason}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        {auditContinuation.failed ? (
          <p className="text-sm" role="alert">
            Следующие записи журнала не прочитались. Прочитанные остаются на
            месте.
          </p>
        ) : null}
        {auditContinuation.hasMore || auditContinuation.failed ? (
          <div>
            <Button
              aria-busy={auditContinuation.loading}
              className="min-h-11 px-4"
              disabled={auditContinuation.loading}
              onClick={auditContinuation.onLoadMore}
              type="button"
              variant="outline"
            >
              {auditContinuation.failed
                ? "Повторить чтение журнала"
                : "Показать ещё записи"}
            </Button>
          </div>
        ) : null}
      </section>

      <ReconcileDialog
        error={reconcile.error}
        onConfirm={reconcile.onConfirm}
        onOpenChange={reconcile.onOpenChange}
        open={reconcile.open}
        pending={reconcile.pending}
      />
    </SalesPaymentFrame>
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:contents">
      <dt className="text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Каркас страницы платежа: `main` маршрута и возврат к списку. Готовая страница, её скелет и
 * состояния ошибки стоят в одном каркасе.
 */
export function SalesPaymentFrame({
  busy = false,
  label,
  children,
}: {
  readonly busy?: boolean;
  /** Имя `main`, пока заголовка страницы ещё нет. */
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={label === undefined ? salesPaymentHeadingId : undefined}
      className="authoring-page"
      data-sales-payment-frame=""
      id="authoring-content"
      tabIndex={-1}
    >
      <div className="authoring-page-body grid-cols-[minmax(0,1fr)] content-start">
        <nav aria-label="Возврат к платежам">
          <Button asChild className="min-h-11 px-3" variant="ghost">
            <Link href={authoringPaymentsHref}>
              <ArrowLeft aria-hidden="true" />
              Все платежи
            </Link>
          </Button>
        </nav>
        <div className="grid max-w-[52rem] grid-cols-[minmax(0,1fr)] gap-6">
          {children}
        </div>
      </div>
    </main>
  );
}
