import type { Route } from "next";

import { internalRoute, isInternalRoute } from "./internal-route";

/**
 * CTA страницы руководства ведёт на витрину и сохраняет контекст: после входа покупатель
 * возвращается к тому же тарифу, а ссылка назад ведёт к исходному материалу. Возвращать можно
 * только на публичные разделы каталога, поэтому список разделов задан явно.
 */
const publicOriginSections = [
  "/guides/",
  "/series/",
  "/topics/",
  "/materials/",
  "/library",
  "/map",
] as const;

export interface SubscriptionRouteTarget {
  /** Куда вернуть покупателя после входа. */
  readonly returnTo: string;
  /** Исходная страница, если она известна и внутренняя. */
  readonly originHref?: Route;
}

function publicOrigin(value: string | undefined): Route | undefined {
  if (value === undefined || !isInternalRoute(value)) return undefined;
  return publicOriginSections.some(
    (section) => value === section.replace(/\/$/u, "") || value.startsWith(section),
  )
    ? internalRoute(value)
    : undefined;
}

export function subscriptionRouteTarget(
  from: string | readonly string[] | undefined,
): SubscriptionRouteTarget {
  const origin = publicOrigin(typeof from === "string" ? from : from?.[0]);
  return origin === undefined
    ? { returnTo: "/subscription" }
    : { returnTo: subscriptionHrefFrom(origin), originHref: origin };
}

/** Страница продукта руководства: она рассказывает и никогда не называет цену. */
export function guideProductHref(slug: string): Route {
  return internalRoute(`/guides/${encodeURIComponent(slug)}`);
}

/**
 * Программа руководства: материалы по главам живут отдельным адресом, потому что страница
 * продукта рассказывает, а программа учит. Приглашение к оплате встречает читателя именно здесь.
 */
export function guideProgrammeHref(slug: string): Route {
  return internalRoute(`/guides/${encodeURIComponent(slug)}/programme`);
}

/**
 * Страница оплаты одного руководства: цена и оформление живут отдельным адресом, потому что
 * покупают здесь именно руководство, а не тариф подписки, и программа до неё только приглашает.
 */
export function guidePurchaseHref(slug: string): Route {
  return internalRoute(`/guides/${encodeURIComponent(slug)}/buy`);
}

/**
 * Ссылка на витрину со страницы руководства или темы. Строка отдаётся `Link` как есть:
 * `pathname` объекта URL заэкранировал бы `?` и увёл бы покупателя на несуществующий путь.
 */
export function subscriptionHrefFrom(origin: string): Route {
  return publicOrigin(origin) === undefined
    ? internalRoute("/subscription")
    : internalRoute(`/subscription?from=${encodeURIComponent(origin)}`);
}
