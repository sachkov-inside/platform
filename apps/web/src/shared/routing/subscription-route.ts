/**
 * CTA страницы руководства ведёт на витрину и сохраняет контекст: после входа покупатель
 * возвращается к тому же тарифу, а ссылка назад ведёт к исходному материалу.
 */
const originPattern =
  /^\/(?:guides|series|topics|materials|library|map)(?:\/[A-Za-z0-9\-._~%]+)*$/u;

export interface SubscriptionRouteTarget {
  /** Куда вернуть покупателя после входа. */
  readonly returnTo: string;
  /** Исходная страница, если она известна и внутренняя. */
  readonly originHref?: string;
}

export function subscriptionRouteTarget(
  from: string | readonly string[] | undefined,
): SubscriptionRouteTarget {
  const value = typeof from === "string" ? from : from?.[0];
  if (value === undefined || !originPattern.test(value))
    return { returnTo: "/subscription" };
  return {
    returnTo: `/subscription?from=${encodeURIComponent(value)}`,
    originHref: value,
  };
}

/** Ссылка на витрину со страницы руководства или темы. */
export function subscriptionHrefFrom(origin: string): string {
  return originPattern.test(origin)
    ? `/subscription?from=${encodeURIComponent(origin)}`
    : "/subscription";
}
