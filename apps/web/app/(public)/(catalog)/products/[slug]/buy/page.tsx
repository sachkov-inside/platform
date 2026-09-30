import type { Metadata } from "next";

import { GuidePurchasePage } from "@/_pages/guide-purchase.server";
import { promoCodeFromQuery } from "@/features/billing-checkout";
import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

interface GuidePurchaseRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
  /** `promo` — промокод персональной ссылки владельца (#815). */
  readonly searchParams: Promise<{
    readonly promo?: string | readonly string[];
  }>;
}

export async function generateMetadata({
  params,
}: GuidePurchaseRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublishedSeries(
    slug,
    await getOptionalPlatformAccessToken(),
  );
  const name =
    result.kind === "ready" || result.kind === "empty"
      ? result.reference.name
      : undefined;
  return {
    title: name === undefined ? "Покупка продукта" : `Купить «${name}»`,
    robots: { follow: true, index: false },
  };
}

export default async function GuidePurchaseRoute({
  params,
  searchParams,
}: GuidePurchaseRouteProps) {
  const { slug } = await params;
  const promoCode = promoCodeFromQuery((await searchParams).promo);
  // Покупка открывается после принятия действующей редакции условий на экране первого входа.
  await redirectUntilTermsAccepted(guidePurchaseHref(slug, promoCode));
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <GuidePurchasePage
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(promoCode === undefined ? {} : { promoCode })}
      slug={slug}
    />
  );
}
