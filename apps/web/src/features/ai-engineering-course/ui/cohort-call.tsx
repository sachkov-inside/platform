import { ArrowDown, ArrowRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./cohort-call.css";

/**
 * Что стоит над кнопкой первого экрана. Карточка называет поток, обещание этапа и пояснение.
 * Живая метка только сообщает, что набор идёт, и ведёт к цене внизу страницы: первый экран не
 * продаёт, человек сначала изучает курс (решение владельца 09.10.2026).
 */
export type CohortBanner =
  | {
      readonly kind: "card";
      readonly label: string;
      readonly text: string;
      readonly detail: string;
    }
  | {
      readonly kind: "live";
      readonly text: string;
      readonly detail: string;
      /** Якорь блока с ценой на этой же странице. */
      readonly href: `#${string}`;
    };

/**
 * Куда ведёт кнопка первого экрана. Программа — страница каталога, её адрес предзагружается по
 * намерению; оплата — отдельная страница покупки; вход идёт формой, потому что это POST.
 */
export type CohortAction =
  | { readonly kind: "programme"; readonly href: Route; readonly label: string }
  | { readonly kind: "purchase"; readonly href: Route; readonly label: string }
  | {
      readonly kind: "sign-in";
      readonly returnTo: Route;
      readonly label: string;
    };

export interface CohortCall {
  readonly banner: CohortBanner | null;
  /**
   * Кнопка по этапу: вход, оплата или своя программа. `null` — кнопки нет: в программу первый
   * экран не уводит, человек сначала изучает страницу (решение владельца 09.10.2026).
   */
  readonly action: CohortAction | null;
}

/** Плашка этапа и кнопка по этапу. Текст и адрес решает модель страницы, здесь только вид. */
export function CohortCallView({ call }: { readonly call: CohortCall }) {
  const { action, banner } = call;
  return (
    <div className="aie-cohort" data-cohort-action={action?.kind ?? "none"}>
      {banner === null ? null : banner.kind === "live" ? (
        <a className="aie-cohort-live" href={banner.href}>
          <span className="aie-cohort-live-dot" aria-hidden="true" />
          <span className="aie-cohort-live-text">{banner.text}</span>
          {banner.detail === "" ? null : (
            <span className="aie-cohort-live-detail">{banner.detail}</span>
          )}
          <ArrowDown aria-hidden="true" />
        </a>
      ) : (
        <div className="aie-cohort-banner">
          <p className="aie-cohort-text">
            <span className="aie-cohort-label">{banner.label}</span>{" "}
            {banner.text}
          </p>
          {banner.detail === "" ? null : (
            <p className="aie-cohort-detail">{banner.detail}</p>
          )}
        </div>
      )}
      {action === null ? null : action.kind === "sign-in" ? (
        <form action="/auth/sign-in" method="post">
          <input name="returnTo" type="hidden" value={action.returnTo} />
          <button className="aie-hero-action" type="submit">
            {action.label}
            <ArrowRight aria-hidden="true" />
          </button>
        </form>
      ) : action.kind === "purchase" ? (
        <Link className="aie-hero-action" href={action.href}>
          {action.label}
          <ArrowRight aria-hidden="true" />
        </Link>
      ) : (
        <IntentPrefetchLink className="aie-hero-action" href={action.href}>
          {action.label}
          <ArrowRight aria-hidden="true" />
        </IntentPrefetchLink>
      )}
    </div>
  );
}
