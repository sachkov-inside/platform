import type { Route } from "next";

import { internalRoute, isInternalRoute } from "./internal-route";
import { guidePath } from "./public-page-path";

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

/**
 * Страница продукта руководства: она рассказывает и никогда не называет цену. Её адрес —
 * канонический адрес руководства, поэтому он остаётся у одного владельца, `public-page-path`.
 */
export const guideProductHref = guidePath;

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

/** Куда ведёт призыв к покупке: оплата выбранного руководства или витрина подписки. */
export type PurchaseInvitation =
  | { readonly kind: "guide"; readonly href: Route }
  | { readonly kind: "subscription"; readonly href: Route };

/**
 * Один призыв к покупке для всех поверхностей: главной, закрытого материала и программы
 * руководства. Своя цена руководства важнее тарифов — человек уже выбрал, что берёт. Выключенная
 * продажа молчит: звать туда, где купить нечего, нельзя. Правило живёт здесь, поэтому поверхности
 * не могут разойтись и увести человека в тупик, а покупка начинается внутри платформы.
 */
export function purchaseInvitation({
  guide,
  subscriptionOffered,
  from,
}: {
  /** Руководство, которое человек сейчас смотрит, и продаётся ли оно отдельно. */
  readonly guide?: { readonly slug: string; readonly sold: boolean } | undefined;
  /** Продаётся ли сейчас хоть один тариф подписки. */
  readonly subscriptionOffered: boolean;
  /** Откуда человек пришёл: витрина вернёт его сюда после входа. */
  readonly from?: string | undefined;
}): PurchaseInvitation | null {
  if (guide?.sold === true) {
    return { kind: "guide", href: guidePurchaseHref(guide.slug) };
  }
  if (!subscriptionOffered) return null;
  return {
    kind: "subscription",
    href: from === undefined ? internalRoute("/subscription") : subscriptionHrefFrom(from),
  };
}
