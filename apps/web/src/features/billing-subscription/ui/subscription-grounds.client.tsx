"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  accessSourceLabel,
  capabilityLabel,
  formatBillingDate,
  type AccessGround,
} from "@/entities/subscription";

export interface SubscriptionGroundsProps {
  readonly grounds: readonly AccessGround[];
  readonly loading: boolean;
  /** Адрес витрины даётся, только когда подписку продают: иначе звать туда не с чем. */
  readonly storefrontHref?: Route | undefined;
}

/**
 * Что уже доступно, по какому основанию и до какого срока. Основания независимы: подписка их
 * не заменяет, а отдельное право на руководство переживает её окончание.
 */
export function SubscriptionGrounds({
  grounds,
  loading,
  storefrontHref,
}: SubscriptionGroundsProps) {
  return (
    <section
      aria-labelledby="billing-grounds"
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2 className="text-xl font-semibold" id="billing-grounds">
        Что вам доступно
      </h2>
      {loading && grounds.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">
          Загружаем основания доступа…
        </p>
      ) : grounds.length === 0 ? (
        <>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Действующих оснований доступа нет.
          </p>
          {storefrontHref === undefined ? null : (
            <Link
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-action underline underline-offset-4"
              href={storefrontHref}
            >
              Посмотреть тарифы
            </Link>
          )}
        </>
      ) : (
        <ul className="mt-4 grid gap-4">
          {grounds.map((ground) => (
            <li
              className="grid gap-2 border-b border-border pb-4 text-sm last:border-b-0 last:pb-0"
              key={`${ground.source}:${ground.startsAt}:${ground.capabilities.join(",")}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-semibold">
                  {accessSourceLabel(ground.source)}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {ground.validUntil === null
                    ? "бессрочно"
                    : `до ${formatBillingDate(ground.validUntil)}`}
                </span>
              </div>
              <ul className="grid gap-1 leading-6">
                {ground.capabilities.map((capability) => (
                  <li className="[overflow-wrap:anywhere]" key={capability}>
                    {capabilityLabel(capability)}
                  </li>
                ))}
              </ul>
              {ground.active ? null : (
                <p className="text-xs text-muted-foreground">
                  Начнёт действовать {formatBillingDate(ground.startsAt)}.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
