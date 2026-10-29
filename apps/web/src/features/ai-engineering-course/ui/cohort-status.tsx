import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PreorderPriceView, type PreorderPrice } from "@/entities/subscription";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./cohort-status.css";

/**
 * Билет в нижнем блоке страницы курса. Слева поток и обещание, рядом пункты блока «что входит»,
 * справа билет: цена, скидка к цене после старта и кнопки. На предзаказе билет продаёт предзаказ,
 * после старта и между потоками доступ к курсу (#1647). Пока продажи нет, в билете нет цены и
 * кнопки оплаты.
 */
export interface CohortStatus {
  /** Что продаёт билет: предзаказ до старта или доступ к идущему курсу. */
  readonly kind: "preorder" | "access";
  /** Сколько дней до старта: «до старта 31 день»; наклейка над заголовком блока. `null` — без неё. */
  readonly countdown: string | null;
  readonly title: string;
  readonly text: string;
  readonly price: PreorderPrice | null;
  /** Скидка к цене после старта: «−25 %»; `null` — сравнивать не с чем. */
  readonly discount: string | null;
  /** Страница оплаты; `null` — оплатить сейчас нельзя или продукт уже открыт. */
  readonly purchaseHref: Route | null;
  readonly programmeHref: Route;
  /** Есть бесплатные уроки: ссылка в программу зовёт попробовать бесплатно. */
  readonly freeStart: boolean;
}

const ticketCopy = {
  preorder: { head: "Предзаказ", purchase: "Оформить предзаказ" },
  access: { head: "Доступ к курсу", purchase: "Приобрести доступ" },
} as const;

export function CohortStatusView({
  status,
}: {
  readonly status: CohortStatus;
}) {
  return (
    <div className="aie-cohort-status">
      <div className="aie-cohort-status-intro">
        {status.countdown === null ? null : (
          <span className="aie-cohort-status-countdown">
            {status.countdown}
          </span>
        )}
        <h2>{status.title}</h2>
        {status.text === "" ? null : <p>{status.text}</p>}
      </div>
      <div className="aie-cohort-ticket-wrap">
        <div className="aie-cohort-ticket">
          <div className="aie-cohort-ticket-head">
            <span>{ticketCopy[status.kind].head}</span>
            {status.discount === null ? null : (
              <span className="aie-cohort-ticket-discount">
                {status.discount}
              </span>
            )}
          </div>
          {status.price === null ? (
            <p className="aie-cohort-ticket-soon">Откроется скоро</p>
          ) : (
            <PreorderPriceView note={null} price={status.price} />
          )}
          <div className="aie-cohort-ticket-tear" aria-hidden="true" />
          <div className="aie-cohort-ticket-actions">
            {status.purchaseHref === null ? null : (
              <Link
                className="aie-cohort-ticket-buy"
                href={status.purchaseHref}
              >
                {ticketCopy[status.kind].purchase}
                <ArrowRight aria-hidden="true" />
              </Link>
            )}
            <IntentPrefetchLink
              className="aie-cohort-ticket-programme"
              href={status.programmeHref}
            >
              {programmeCallLabel(status.freeStart)}
            </IntentPrefetchLink>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Вторая ссылка билета ведёт в программу; при бесплатных уроках она зовёт попробовать (#1647). */
export function programmeCallLabel(freeStart: boolean): string {
  return freeStart ? "Попробовать бесплатно" : "Открыть программу";
}
