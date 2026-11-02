import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

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
  preorder: {
    head: "Предзаказ",
    purchase: "Оформить предзаказ",
    struck: "Цена после старта",
  },
  // Курс продаётся без потоков: зачёркнута цена без скидки (решение владельца 02.11.2026).
  access: {
    head: "Доступ к курсу",
    purchase: "Приобрести доступ",
    struck: "Цена без скидки",
  },
} as const;

export function CohortStatusView({
  status,
  contact,
  telegramHandle,
}: {
  readonly status: CohortStatus;
  /** Связь с автором под кнопками билета; страница курса решает, на какой ник она ведёт. */
  readonly contact?: ReactNode;
  /** Ник автора: под кнопкой оплаты к нему зовут тех, кто платит не из России. Без ника строки нет. */
  readonly telegramHandle?: string | undefined;
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
            <PreorderPriceView
              note={null}
              price={status.price}
              struckLabel={ticketCopy[status.kind].struck}
            />
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
            {status.purchaseHref === null ? null : (
              <PaymentNotes telegramHandle={telegramHandle} />
            )}
            <IntentPrefetchLink
              className="aie-cohort-ticket-programme"
              href={status.programmeHref}
            >
              {programmeCallLabel(status.freeStart)}
            </IntentPrefetchLink>
          </div>
          {contact}
        </div>
      </div>
    </div>
  );
}

/**
 * Способы оплаты под кнопкой покупки: части через «Долями» на форме Т-Банка и связь с автором для
 * тех, кто платит не из России (решение владельца 02.11.2026). Строки не списком: стили страницы
 * курса красят пункты списков в тёмном блоке.
 */
function PaymentNotes({
  telegramHandle,
}: {
  readonly telegramHandle: string | undefined;
}) {
  return (
    <div className="aie-cohort-ticket-payment">
      <span>Можно оплатить частями через «Долями».</span>
      {telegramHandle === undefined ? null : (
        <span>
          Не из России?{" "}
          <a
            href={`https://t.me/${telegramHandle}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            Напиши мне в Telegram
          </a>
          , помогу с оплатой.
        </span>
      )}
    </div>
  );
}

/** Вторая ссылка билета ведёт в программу; при бесплатных уроках она зовёт попробовать (#1647). */
export function programmeCallLabel(freeStart: boolean): string {
  return freeStart ? "Попробовать бесплатно" : "Открыть программу";
}
