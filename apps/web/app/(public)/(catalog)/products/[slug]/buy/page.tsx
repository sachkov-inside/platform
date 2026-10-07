import type { Metadata } from "next";

import { ProductPurchasePage } from "@/_pages/product-purchase.server";
import { promoCodeFromQuery } from "@/features/billing-checkout";
import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import {
  subscriptionOfferParam,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

interface ProductPurchaseRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
  /** `promo` — промокод персональной ссылки владельца (#815). */
  readonly searchParams: Promise<{
    readonly promo?: string | readonly string[];
    readonly offer?: string | readonly string[];
  }>;
}

export async function generateMetadata({
  params,
}: ProductPurchaseRouteProps): Promise<Metadata> {
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

export default async function ProductPurchaseRoute({
  params,
  searchParams,
}: ProductPurchaseRouteProps) {
  const { slug } = await params;
  const query = await searchParams;
  const promoCode = promoCodeFromQuery(query.promo);
  const offerId = subscriptionOfferParam(query.offer);
  // Покупка открывается после принятия действующей редакции условий на экране первого входа.
  await redirectUntilTermsAccepted(
    productPurchaseHref(slug, promoCode, offerId),
  );
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <ProductPurchasePage
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(promoCode === undefined ? {} : { promoCode })}
      {...(offerId === undefined ? {} : { offerId })}
      slug={slug}
    />
  );
}
