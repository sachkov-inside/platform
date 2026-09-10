import { isInternalRoute } from "./internal-route";

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
  readonly originHref?: string;
}

function publicOrigin(value: string | undefined): string | undefined {
  if (value === undefined || !isInternalRoute(value)) return undefined;
  return publicOriginSections.some(
    (section) => value === section.replace(/\/$/u, "") || value.startsWith(section),
  )
    ? value
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

/** Ссылка на витрину со страницы руководства или темы. */
export function subscriptionHrefFrom(origin: string): string {
  return publicOrigin(origin) === undefined
    ? "/subscription"
    : `/subscription?from=${encodeURIComponent(origin)}`;
}
