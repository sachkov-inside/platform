import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PreorderPriceView, type PreorderPrice } from "@/entities/subscription";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./cohort-status.css";

/**
 * Набор на поток в нижнем блоке страницы курса. Слева поток и обещание, рядом пункты блока
 * «что входит», справа билет: цена предзаказа, скидка к цене после старта и кнопки. Пока
 * предзаказ не открыт, в билете нет цены и кнопки оплаты.
 */
export interface CohortStatus {
  /** Поток и день старта: «Поток 1 · старт 9 ноября». */
  readonly label: string;
  readonly title: string;
  readonly text: string;
  readonly price: PreorderPrice | null;
  /** Скидка к цене после старта: «−25 %»; `null` — сравнивать не с чем. */
  readonly discount: string | null;
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
      <div className="aie-cohort-status-intro">
        <span className="aie-cohort-status-label">
          <span className="aie-cohort-status-dot" aria-hidden="true" />
          {status.label}
        </span>
        <h2>{status.title}</h2>
        <p>{status.text}</p>
      </div>
      <div className="aie-cohort-ticket">
        <div className="aie-cohort-ticket-head">
          <span>Предзаказ</span>
          {status.discount === null ? null : (
            <span className="aie-cohort-ticket-discount">
              {status.discount}
            </span>
          )}
        </div>
        {status.price === null ? (
          <p className="aie-cohort-ticket-soon">Откроется скоро</p>
        ) : (
          <PreorderPriceView price={status.price} />
        )}
        <div className="aie-cohort-ticket-tear" aria-hidden="true" />
        <div className="aie-cohort-ticket-actions">
          {status.purchaseHref === null ? null : (
            <Link className="aie-cohort-ticket-buy" href={status.purchaseHref}>
              Оформить предзаказ
              <ArrowRight aria-hidden="true" />
            </Link>
          )}
          <IntentPrefetchLink
            className="aie-cohort-ticket-programme"
            href={status.programmeHref}
          >
            Открыть программу
          </IntentPrefetchLink>
        </div>
        {status.purchaseHref === null ? null : (
          <p className="aie-cohort-ticket-note">
            Опубликованные главы и сообщество откроются сразу после оплаты.
          </p>
        )}
      </div>
    </div>
  );
}
