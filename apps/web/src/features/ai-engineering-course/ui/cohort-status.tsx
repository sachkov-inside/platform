import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PreorderPriceView, type PreorderPrice } from "@/entities/subscription";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./cohort-status.css";

/**
 * Плашка набора в нижнем блоке страницы курса: поток, дата старта, цена предзаказа рядом с ценой
 * после старта и две кнопки. Пока предзаказ не открыт, кнопки оплаты нет.
 */
export interface CohortStatus {
  readonly label: string;
  readonly title: string;
  readonly text: string;
  readonly price: PreorderPrice | null;
  /** Страница оплаты; `null` — оплатить сейчас нельзя или продукт уже открыт. */
  readonly purchaseHref: Route | null;
  readonly programmeHref: Route;
}

export function CohortStatusView({
  status,
}: {
  readonly status: CohortStatus;
}) {
  return (
    <div className="aie-cohort-status">
      <span className="aie-cohort-status-label">{status.label}</span>
      <h2>{status.title}</h2>
      <p>{status.text}</p>
      {status.price === null ? null : (
        <PreorderPriceView price={status.price} tone="dark" />
      )}
      <div className="aie-cohort-status-actions">
        {status.purchaseHref === null ? null : (
          <Link className="aie-cohort-status-buy" href={status.purchaseHref}>
            Оформить предзаказ
            <ArrowRight aria-hidden="true" />
          </Link>
        )}
        <IntentPrefetchLink
          className="aie-cohort-status-programme"
          href={status.programmeHref}
        >
          Открыть программу
        </IntentPrefetchLink>
      </div>
    </div>
  );
}
