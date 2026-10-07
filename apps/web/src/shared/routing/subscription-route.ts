import type { Route } from "next";

import { internalRoute, isInternalRoute } from "./internal-route";
import { productPath } from "./public-page-path";

/**
 * CTA страницы руководства ведёт на витрину и сохраняет контекст: после входа покупатель
 * возвращается к тому же тарифу, а ссылка назад ведёт к исходному материалу. Возвращать можно
 * только на публичные разделы каталога, поэтому список разделов задан явно.
 */
const publicOriginSections = [
  "/products/",
  // Прежние адреса продукта перенаправляются на `/products/`, поэтому старый возврат остаётся рабочим.
  "/guides/",
  "/series/",
  "/topics/",
  "/materials/",
  "/map",
] as const;

export interface SubscriptionRouteTarget {
  /** Куда вернуть покупателя после входа. */
  readonly returnTo: string;
  /** Исходная страница, если она известна и внутренняя. */
  readonly originHref?: Route;
  /** Предложение, которое витрина выбирает сразу: его открывает кнопка «Оплатить» в боте (#908). */
  readonly offerId?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Параметр `offer` принимается одной строкой вида uuid; всё остальное витрина не замечает. */
export function subscriptionOfferParam(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" && uuidPattern.test(value)
    ? value.toLowerCase()
    : undefined;
}

function publicOrigin(value: string | undefined): Route | undefined {
  if (value === undefined || !isInternalRoute(value)) return undefined;
  if (value === "/") return internalRoute(value);
  return publicOriginSections.some(
    (section) =>
      value === section.replace(/\/$/u, "") || value.startsWith(section),
  )
    ? internalRoute(value)
    : undefined;
}

export function subscriptionRouteTarget(
  from: string | readonly string[] | undefined,
  offer?: string | readonly string[],
): SubscriptionRouteTarget {
  const origin = publicOrigin(typeof from === "string" ? from : from?.[0]);
  const offerId = subscriptionOfferParam(offer);
  // Выбранное предложение переживает вход так же, как исходная страница.
  const query = new URLSearchParams();
  if (origin !== undefined) query.set("from", origin);
  if (offerId !== undefined) query.set("offer", offerId);
  const search = query.toString();
  return {
    returnTo:
      search === "" ? "/payment/checkout" : `/payment/checkout?${search}`,
    ...(origin === undefined ? {} : { originHref: origin }),
    ...(offerId === undefined ? {} : { offerId }),
  };
}

/**
 * Страница продукта руководства: она рассказывает и никогда не называет цену. Её адрес —
 * канонический адрес руководства, поэтому он остаётся у одного владельца, `public-page-path`.
 */
export const productHref = productPath;

/**
 * Программа руководства: материалы по главам живут отдельным адресом, потому что страница
 * продукта рассказывает, а программа учит. Приглашение к оплате встречает читателя именно здесь.
 */
export function productProgrammeHref(slug: string): Route {
  return internalRoute(`/products/${encodeURIComponent(slug)}/programme`);
}

/** Страница задания внутри своего руководства (#947): код задания постоянный, адрес тоже. */
export function productTaskHref(slug: string, code: string): Route {
  return internalRoute(
    `/products/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(code)}`,
  );
}

/**
 * Страница оплаты одного руководства: цена и оформление живут отдельным адресом, потому что
 * покупают здесь именно руководство, а не тариф подписки, и программа до неё только приглашает.
 * Персональная ссылка владельца несёт промокод: он переживает вход и экран условий (#815).
 */
export function productPurchaseHref(
  slug: string,
  promoCode?: string,
  offerId?: string,
): Route {
  const path = `/products/${encodeURIComponent(slug)}/buy`;
  const query = new URLSearchParams();
  if (promoCode !== undefined) query.set("promo", promoCode);
  if (offerId !== undefined) query.set("offer", offerId);
  const search = query.toString();
  return internalRoute(search === "" ? path : `${path}?${search}`);
}

/**
 * Ссылка на витрину со страницы руководства или темы. Строка отдаётся `Link` как есть:
 * `pathname` объекта URL заэкранировал бы `?` и увёл бы покупателя на несуществующий путь.
 */
export function subscriptionHrefFrom(origin: string): Route {
  return publicOrigin(origin) === undefined
    ? internalRoute("/payment/checkout")
    : internalRoute(`/payment/checkout?from=${encodeURIComponent(origin)}`);
}

/** Куда ведёт призыв к покупке: оплата выбранного руководства или витрина подписки. */
export type PurchaseInvitation =
  | { readonly kind: "product"; readonly href: Route }
  | { readonly kind: "subscription"; readonly href: Route };

/**
 * Один призыв к покупке для всех поверхностей: главной, закрытого материала и программы
 * руководства. Своя цена руководства важнее тарифов — человек уже выбрал, что берёт. Выключенная
 * продажа молчит: звать туда, где купить нечего, нельзя. Правило живёт здесь, поэтому поверхности
 * не могут разойтись и увести человека в тупик, а покупка начинается внутри платформы.
 */
export function purchaseInvitation({
  product,
  subscriptionOffered,
  from,
}: {
  /** Руководство, которое человек сейчас смотрит, и продаётся ли оно отдельно. */
  readonly product?:
    { readonly slug: string; readonly sold: boolean } | undefined;
  /** Продаётся ли сейчас хоть один тариф подписки. */
  readonly subscriptionOffered: boolean;
  /** Откуда человек пришёл: витрина вернёт его сюда после входа. */
  readonly from?: string | undefined;
}): PurchaseInvitation | null {
  if (product?.sold === true) {
    return { kind: "product", href: productPurchaseHref(product.slug) };
  }
  if (!subscriptionOffered) return null;
  return {
    kind: "subscription",
    href:
      from === undefined
        ? internalRoute("/payment/checkout")
        : subscriptionHrefFrom(from),
  };
}
