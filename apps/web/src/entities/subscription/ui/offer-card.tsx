import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

import type { PriceSnapshot } from "../model/billing-contract";
import {
  benefitLines,
  formatKopecks,
  formatMonths,
  promotionLabel,
} from "../model/presentation";

export interface OfferCardProps {
  readonly snapshot: PriceSnapshot;
  /** Тариф, по которому уже держится действующая подписка. */
  readonly current?: boolean;
  readonly selected?: boolean;
  readonly headingLevel?: "h2" | "h3";
  readonly children?: ReactNode;
}

/**
 * Состав и цена приходят снимком сервера. Карточка ничего не пересчитывает и не обещает
 * условий, которых нет в снимке.
 */
export function OfferCard({
  snapshot,
  current = false,
  selected = false,
  headingLevel = "h3",
  children,
}: OfferCardProps) {
  const Heading = headingLevel;
  const promotion = promotionLabel(snapshot);
  const lines = benefitLines(snapshot.offer, snapshot.paymentOption.months);
  const renewalDiffers =
    snapshot.renewalPriceKopecks !== snapshot.firstPriceKopecks;
  return (
    <article
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-2xl border bg-card p-6 shadow-card",
        selected ? "border-accent" : "border-border",
      )}
      data-offer={snapshot.paymentOption.id}
    >
      <header className="min-w-0">
        {current ? (
          <p className="mb-2 inline-flex min-h-7 items-center rounded-full bg-secondary px-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-action">
            Ваш тариф
          </p>
        ) : null}
        <Heading className="text-balance text-2xl font-bold tracking-[-0.035em] [overflow-wrap:anywhere]">
          {snapshot.offer.name}
        </Heading>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-bold tabular-nums tracking-[-0.04em]">
            {formatKopecks(snapshot.firstPriceKopecks)}
          </span>
          <span className="text-sm text-muted-foreground">
            за {formatMonths(snapshot.paymentOption.months)}
          </span>
        </p>
        {promotion === undefined ? null : (
          <p className="mt-2 font-mono text-xs text-action">{promotion}</p>
        )}
        {renewalDiffers ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Дальше — {formatKopecks(snapshot.renewalPriceKopecks)} за тот же
            срок.
          </p>
        ) : null}
        {snapshot.offer.archived || snapshot.paymentOption.archived ? (
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            Предложение снято с продажи; действующие подписки продолжают
            работать.
          </p>
        ) : null}
      </header>
      <ul className="mt-5 grid flex-1 gap-2 text-sm leading-6">
        {lines.map((line) => (
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
      {children === undefined ? null : <div className="mt-6">{children}</div>}
    </article>
  );
}
