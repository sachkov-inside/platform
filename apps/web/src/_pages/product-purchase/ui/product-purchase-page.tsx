import { notFound } from "next/navigation";

import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";

import { ProductPurchase } from "./product-purchase.client";

/**
 * Страница оплаты одного руководства: название и все его варианты приходят с сервера, а оформление
 * идёт тем же путём расчёта, согласий и оплаты, что и подписка. Страница не знает о разовости,
 * поэтому подписка на руководство и несколько тарифов встанут сюда же без второй страницы.
 */
export async function ProductPurchasePage({
  accessToken,
  offerId,
  promoCode,
  slug,
}: {
  readonly accessToken?: string;
  readonly offerId?: string;
  /** Промокод персональной ссылки: расчёт цены применяет его, если он действует. */
  readonly promoCode?: string;
  readonly slug: string;
}) {
  const product = await loadPublishedSeries(slug, accessToken);
  if (product.kind === "not-found") notFound();
  if (product.kind === "unavailable" || product.reference.id === undefined) {
    return (
      <ProductPurchase
        product={null}
        offers={[]}
        {...(offerId === undefined ? {} : { offerId })}
        slug={slug}
        unavailable
        {...(promoCode === undefined ? {} : { promoCode })}
      />
    );
  }
  const catalog = await (accessToken === undefined
    ? readGuestProductSale(product.reference.id)
    : readViewerProductSale(product.reference.id, accessToken));
  return (
    <ProductPurchase
      product={{
        name: product.reference.name,
        summary: product.reference.summary,
      }}
      offers={catalog.kind === "ready" ? catalog.offers : []}
      {...(offerId === undefined ? {} : { offerId })}
      slug={slug}
      {...(promoCode === undefined ? {} : { promoCode })}
      unavailable={catalog.kind === "unavailable"}
    />
  );
}
