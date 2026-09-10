"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  formatBillingDate,
  formatKopecks,
  noticeLabel,
  type NoticeView,
} from "@/entities/subscription";

export interface SubscriptionNoticesProps {
  readonly notices: readonly NoticeView[];
  readonly contactHref: Route;
}

/** Служебные сообщения подписки: сам факт повода, без текста письма и получателей. */
export function SubscriptionNotices({
  notices,
  contactHref,
}: SubscriptionNoticesProps) {
  return (
      <section
        aria-labelledby="billing-history"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="text-xl font-semibold" id="billing-history">
          История сообщений
        </h2>
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
