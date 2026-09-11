"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  attemptStateLabel,
  formatBillingDate,
  formatKopecks,
  formatMonths,
  noticeLabel,
  type NoticeView,
  type OwnPayment,
} from "@/entities/subscription";

export interface SubscriptionNoticesProps {
  readonly notices: readonly NoticeView[];
  readonly payments: readonly OwnPayment[];
  readonly contactHref: Route;
}

/**
 * История: собственные списания и служебные поводы. Ссылка на конкретную операцию нужна
 * поддержке, поэтому она показана рядом с платежом.
 */
export function SubscriptionNotices({
  notices,
  payments,
  contactHref,
}: SubscriptionNoticesProps) {
  return (
      <section
        aria-labelledby="billing-history"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="text-xl font-semibold" id="billing-history">
          История
        </h2>
        <h3 className="mt-4 text-base font-semibold">Списания</h3>
        {payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Списаний по этому Account ещё не было.
          </p>
        ) : (
          <ol className="mt-3 grid gap-3">
            {payments.map((payment) => (
              <li
                className="grid gap-1 border-b border-border pb-3 text-sm last:border-b-0 last:pb-0"
                key={payment.purchaseRef}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                    {payment.offerName} · {formatMonths(payment.months)}
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {formatKopecks(payment.amountKopecks)}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {attemptStateLabel(payment.state)}
                  {payment.confirmedAt === null
                    ? ""
                    : ` · ${formatBillingDate(payment.confirmedAt)}`}
                  {payment.fiscalization === "confirmed"
                    ? " · чек отправлен"
                    : ""}
                </span>
                <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {`операция ${payment.purchaseRef}`}
                </span>
              </li>
            ))}
          </ol>
        )}

        <h3 className="mt-6 text-base font-semibold">Сообщения</h3>
        {notices.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Служебных сообщений пока не было.
          </p>
        ) : (
          <ol className="mt-4 grid gap-3">
            {notices.map((notice) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3 text-sm last:border-b-0 last:pb-0"
                key={notice.noticeRef}
              >
                <span className="min-w-0 font-medium">
                  {noticeLabel(notice.kind)}
                  {notice.state === "superseded" ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      неактуально
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatBillingDate(notice.occurredAt)}
                  {notice.amountKopecks === null
                    ? ""
                    : ` · ${formatKopecks(notice.amountKopecks)}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Чек и письма приходят на{" "}
          <Link
            className="text-action underline underline-offset-4"
            href={contactHref}
          >
            подтверждённый email
          </Link>
          .
        </p>
      </section>
  );
}
